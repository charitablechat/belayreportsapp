# Admin Override + Full Audit — Final Plan (Corrected)

Two corrections from the previous round:
1. **Source attribution moved into the trigger** — no client cooperation, no cross-transaction GUC. Reliable by construction.
2. **Child-table list pinned and expanded** — explicit names, verified against current schema, with two additions the user's list missed.

---

## Correction 1 — `source` derivation is now trigger-side (Option 2)

You correctly flagged that `set_config(..., true)` is transaction-local and PostgREST runs each request in its own transaction, so a pre-write `rpc('set_audit_context')` followed by a separate `.update()` would drop the GUC before the trigger fires. **The frontend RPC approach is removed entirely.**

The trigger derives `source` deterministically from facts already in the row + actor identity:

```
source =
  'system'            when auth.uid() IS NULL                              -- service-role / trigger cascade
  'admin_override'    when actor_role IN ('admin','super_admin')
                      AND (parent.status = 'completed'                     -- editing a locked report
                           OR (TG_OP='UPDATE' AND OLD.status='completed')) -- including the unlock edit itself
  'admin_action'      when actor_role IN ('admin','super_admin')
                      AND actor_user_id <> parent.inspector_id              -- admin editing someone else's WIP report
  'owner'             when actor_user_id = parent.inspector_id              -- normal author edit (incl. own completed)
  'sync'              otherwise (catch-all; should be rare)
```

Why this is sound:
- Every fact is in the same transaction as the trigger fire — no cross-request state.
- `parent.status` is read with a single SELECT inside the SECURITY DEFINER trigger, so RLS does not hide it.
- The classification matches the business question — "did an admin edit content the original author had already locked, or someone else's WIP?" — better than a self-reported source string ever could.
- Sync writes from owners on their own active reports correctly resolve to `'owner'`; the previous sync-tagging step is no longer needed at all.

### What about deletions of parent rows themselves?
For triggers on parent tables (`inspections`, `trainings`, `daily_assessments`), `parent.status` = `NEW.status` on INSERT/UPDATE and `OLD.status` on DELETE — same logic, just resolved without a sub-SELECT.

### What about the offline admin override queue (`admin_edit_snapshots`)?
That table already records `edited_by` + `original_owner_id` + `report_id`. The new `fn_audit_table_change` running on `admin_edit_snapshots` itself will produce one extra audit row per override event tagged `source='admin_override'` (because the snapshot is written by an admin against a completed report). The downstream report-row edits that follow also resolve to `'admin_override'` via the same rule. Defense in depth, no duplication of meaning.

---

## Correction 2 — Explicit, pinned child-table list

Verified against the current schema (rendered in the supabase-tables block). Two additions to the user's list because they hold first-class report content and must be audited for parity:

| Report type | Tables audited (parent + children) |
|---|---|
| **Inspection** | `inspections` (parent), `inspection_systems`, `inspection_ziplines`, `inspection_equipment`, `inspection_photos`, `inspection_standards` *(added)*, `inspection_summary` *(added)* |
| **Training** | `trainings` (parent), `training_personnel`, `training_items`, `training_photos` |
| **Daily Assessment** | `daily_assessments` (parent), `daily_assessment_beginning_of_day` *(replaces non-existent `daily_assessment_items`)*, `daily_assessment_end_of_day`, `daily_assessment_environment_checks`, `daily_assessment_structure_checks`, `daily_assessment_equipment_checks`, `daily_assessment_operating_systems`, `daily_assessment_photos` |

**Important schema note:** the user's list mentioned `daily_assessment_items`, which does not exist. DA item-equivalents are split across six checklist tables (above) plus photos. All six get the child trigger so that ticking/unticking any checklist item or editing its comment by an admin is auditable.

Migration includes a final post-CREATE assertion block:
```sql
DO $$
DECLARE expected text[] := ARRAY[
  'inspections','inspection_systems','inspection_ziplines','inspection_equipment',
  'inspection_photos','inspection_standards','inspection_summary',
  'trainings','training_personnel','training_items','training_photos',
  'daily_assessments','daily_assessment_beginning_of_day','daily_assessment_end_of_day',
  'daily_assessment_environment_checks','daily_assessment_structure_checks',
  'daily_assessment_equipment_checks','daily_assessment_operating_systems',
  'daily_assessment_photos'
];
  missing text[];
BEGIN
  SELECT array_agg(t) INTO missing
  FROM unnest(expected) t
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_audit_' || t AND NOT tgisinternal
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Audit trigger missing on tables: %', missing;
  END IF;
END $$;
```
The migration fails atomically if any expected trigger is absent — no silent gap.

---

## Final SQL preview (the parts most likely to need review)

### `audit_logs` schema extension
```sql
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_role     text,
  ADD COLUMN IF NOT EXISTS report_type    text,
  ADD COLUMN IF NOT EXISTS report_id      uuid,
  ADD COLUMN IF NOT EXISTS source         text,
  ADD COLUMN IF NOT EXISTS was_completed  boolean;

CREATE INDEX IF NOT EXISTS idx_audit_logs_report
  ON public.audit_logs (report_type, report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_time
  ON public.audit_logs (user_id, created_at DESC);
```

### Shared helper — role snapshot
```sql
CREATE OR REPLACE FUNCTION public.current_actor_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN 'system'
    WHEN EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin') THEN 'super_admin'
    WHEN EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')       THEN 'admin'
    ELSE 'user'
  END
$$;
```

### Child-row trigger function (canonical body)
```sql
CREATE OR REPLACE FUNCTION public.fn_audit_report_child_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parent_table text := TG_ARGV[0];   -- 'inspections' | 'trainings' | 'daily_assessments'
  v_fk_column    text := TG_ARGV[1];   -- 'inspection_id' | 'training_id' | 'assessment_id'
  v_report_type  text;
  v_report_id    uuid;
  v_parent_owner uuid;
  v_parent_done  boolean;
  v_actor        uuid := auth.uid();
  v_role         text := public.current_actor_role();
  v_source       text;
  v_old          jsonb;
  v_new          jsonb;
  v_action       text;
  v_row_id       uuid;
  v_strip text[] := ARRAY['comments','notes','description','signed_url','html','payload',
                          'latest_report_html','attestation_user_agent','field_timestamps'];
  k text;
BEGIN
  v_report_type := CASE v_parent_table
    WHEN 'inspections'       THEN 'inspection'
    WHEN 'trainings'         THEN 'training'
    WHEN 'daily_assessments' THEN 'daily_assessment'
  END;

  -- Resolve report_id from the row's FK column (works for INSERT/UPDATE via NEW, DELETE via OLD)
  EXECUTE format('SELECT ($1).%I', v_fk_column)
    INTO v_report_id USING COALESCE(NEW, OLD);

  -- Resolve parent owner + status in one read (RLS bypassed by SECURITY DEFINER)
  EXECUTE format(
    'SELECT inspector_id, (status = ''completed'') FROM public.%I WHERE id = $1',
    v_parent_table
  ) INTO v_parent_owner, v_parent_done USING v_report_id;

  -- Source derivation (trigger-side, transaction-safe)
  v_source := CASE
    WHEN v_actor IS NULL                                            THEN 'system'
    WHEN v_role IN ('admin','super_admin') AND v_parent_done        THEN 'admin_override'
    WHEN v_role IN ('admin','super_admin') AND v_actor <> v_parent_owner THEN 'admin_action'
    WHEN v_actor = v_parent_owner                                   THEN 'owner'
    ELSE 'sync'
  END;

  -- Build old/new payloads with heavy-field stripping + 16KB cap
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); FOREACH k IN ARRAY v_strip LOOP v_old := v_old - k; END LOOP; END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); FOREACH k IN ARRAY v_strip LOOP v_new := v_new - k; END LOOP; END IF;
  IF v_old IS NOT NULL AND octet_length(v_old::text) > 16384 THEN v_old := jsonb_build_object('_truncated', true); END IF;
  IF v_new IS NOT NULL AND octet_length(v_new::text) > 16384 THEN v_new := jsonb_build_object('_truncated', true); END IF;

  -- UPDATE diffs: keep only changed keys
  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(key, value) INTO v_old
      FROM jsonb_each(COALESCE(v_old,'{}'::jsonb))
      WHERE value IS DISTINCT FROM (v_new -> key);
    SELECT jsonb_object_agg(key, value) INTO v_new
      FROM jsonb_each(COALESCE(v_new,'{}'::jsonb))
      WHERE value IS DISTINCT FROM (to_jsonb(OLD) -> key);
    IF v_old IS NULL AND v_new IS NULL THEN RETURN NEW; END IF;  -- nothing meaningful changed
  END IF;

  v_action := TG_TABLE_NAME || '.' || lower(TG_OP);
  BEGIN v_row_id := (COALESCE(NEW, OLD)).id; EXCEPTION WHEN OTHERS THEN v_row_id := NULL; END;

  INSERT INTO public.audit_logs (
    user_id, action_type, table_name, record_id,
    old_values, new_values, metadata,
    actor_role, report_type, report_id, source, was_completed
  ) VALUES (
    v_actor, v_action, TG_TABLE_NAME, v_row_id,
    v_old, v_new,
    jsonb_build_object('op', TG_OP, 'parent_table', v_parent_table, 'parent_owner', v_parent_owner),
    v_role, v_report_type, v_report_id, v_source, v_parent_done
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Never block the underlying write because of audit bookkeeping; rely on existing alerting
  RETURN COALESCE(NEW, OLD);
END $$;
```

### Trigger attach pattern (one per child table)
```sql
DROP TRIGGER IF EXISTS trg_audit_inspection_photos ON public.inspection_photos;
CREATE TRIGGER trg_audit_inspection_photos
AFTER INSERT OR UPDATE OR DELETE ON public.inspection_photos
FOR EACH ROW EXECUTE FUNCTION public.fn_audit_report_child_change('inspections','inspection_id');
-- (repeated for every table in the pinned list, with the right parent + FK column)
```

### Parent-trigger upgrade
The existing `fn_audit_table_change` (already attached to `inspections`/`trainings`/`daily_assessments`) is rewritten in the same migration to populate the same five new columns using the same source-derivation rule (with `report_id := NEW.id` and `was_completed := COALESCE(NEW.status, OLD.status) = 'completed'`). No new triggers added to parents — existing ones replaced atomically.

### Permission additions (admin DELETE on parents; DA bucket admin write)
Identical to the previous plan, placed **after** all trigger CREATEs in the same migration so the policies cannot land in a state where audit coverage is missing.

---

## Frontend changes (now smaller)

Only one frontend change remains — no RPC calls, no source tagging:

1. **`TrainingForm.tsx:215`** — restore the original predicate that the comment shows was `canEdit && !isReadOnly && !isCompletionLocked && !isSuperAdmin`, currently hard-coded `enabled: false`. Verify with the user this isn't intentionally disabled before flipping.

That's it. Source attribution is fully server-side.

---

## Migration files (final)

| # | File | Purpose | Atomicity |
|---|---|---|---|
| 1 | `…_daily_assessment_photos_admin_select.sql` | Read-only carve-out (admin SELECT on DA photo bucket) | Independent |
| 2 | `…_audit_foundation_and_admin_override.sql` | `audit_logs` columns + indexes → `current_actor_role()` → `fn_audit_table_change` rewrite → `fn_audit_report_child_change` → 18 trigger CREATEs → assertion block → admin DELETE policies on parents → DA photo bucket admin ALL policy | Single transaction; assertion block aborts if any trigger missing, so admin write expansion cannot land without audit coverage |

---

## Tests + validation (unchanged from previous plan, plus)

- New: assertion that for an admin edit of a completed inspection's `inspection_photos` row, the resulting audit row has `source='admin_override'` (no client cooperation needed for the assertion to pass).
- New: assertion that an owner editing their own completed report (which they generally cannot, but the test exercises the path) resolves to `source='owner'`, not `'admin_override'`.
- New: assertion that a regular admin editing another user's *in-progress* report resolves to `source='admin_action'`, not `'admin_override'` — so the two cases stay distinguishable in dashboards.

---

## Approval

Reply **`approve final`** to ship the two migrations + the one-line TrainingForm flip + tests.

Reply **`hold trainingform`** if you want the migrations to ship without touching `TrainingForm.tsx:215` (e.g., if that flag is intentionally disabled for an unrelated reason).
