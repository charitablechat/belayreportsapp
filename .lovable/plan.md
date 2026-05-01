# Cut Cloud disk I/O before upgrading

Production telemetry shows two patterns burning your I/O budget. This plan attacks them in priority order. **All Phase 1 fixes are server-side only** — zero risk to your offline-first sync logic, photo pipeline, or auth state machine.

## What the data shows

From `pg_stat_user_tables` on production right now:

```
TABLE                    SEQ SCANS    ROWS READ        UPDATES    LIVE ROWS
user_roles               9,490,423    162,734,671      0          0 idx scans
inspection_equipment        35,486     30,300,035      434,805    862
inspection_systems          35,503     28,964,402      344,397    824
inspection_standards        35,421     12,338,181      140,178    353
inspection_ziplines         35,145      1,580,424       23,786     45
```

Two stories:
1. **Every single RLS check on every query is doing a full scan of `user_roles`.** No index is being hit. This runs on every inspection list, every photo load, every realtime event.
2. **Inspection child tables are being rewritten ~500x per live row.** That's auto-save writing back unchanged data.

## Phase 1 — Server-only, near-zero risk (do this first)

### 1.1 Add the missing `user_roles` indexes

`is_admin_or_above()`, `is_super_admin()`, and `has_role(_user_id, _org_id, _role)` all filter by `(user_id, role)` and sometimes `(user_id, organization_id, role)`. Right now these scan the whole table.

Migration:
```sql
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id_role
  ON public.user_roles (user_id, role);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_org_role
  ON public.user_roles (user_id, organization_id, role)
  WHERE organization_id IS NOT NULL;
```

**Expected impact:** 90%+ reduction in `user_roles` reads. This single change likely drops you well under the 69% disk I/O threshold by itself.

### 1.2 Add a no-op-update guard to inspection child tables

Your existing `update_updated_at_column()` already short-circuits when nothing changed — but the auto-save in `InspectionForm` is upserting full rows, so Postgres still writes the row, the WAL, every index entry, and runs autovacuum even though no column actually changed. The trigger only suppresses `updated_at` bumps.

Add a real "skip writes when no business field changed" guard at the trigger level. We already have the comparison logic; we just need to actually return NULL instead of writing the row when it would be a no-op:

```sql
CREATE OR REPLACE FUNCTION public.skip_noop_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_compare jsonb;
  new_compare jsonb;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  old_compare := to_jsonb(OLD) - 'updated_at' - 'synced_at';
  new_compare := to_jsonb(NEW) - 'updated_at' - 'synced_at';
  IF old_compare = new_compare THEN
    RETURN NULL; -- skip the write entirely
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_skip_noop_inspection_equipment
  BEFORE UPDATE ON public.inspection_equipment
  FOR EACH ROW EXECUTE FUNCTION public.skip_noop_update();
-- repeat for inspection_systems, inspection_standards, inspection_ziplines
```

**Expected impact:** Cuts inspection child-table updates by 80%+ based on the churn ratio (500 updates per live row strongly implies most are no-ops). Drops WAL volume, index churn, and autovacuum pressure.

**Compatibility:** Returns `NULL` from a `BEFORE UPDATE` trigger is the standard Postgres no-op pattern — `.update().select()` calls in your client just get no row back, which they already handle as "no change". Realtime `postgres_changes` will not fire for skipped rows, which is *correct* (nothing changed). LWW conflict resolution still works because `updated_at` is unchanged.

### 1.3 Replace `select('*', { count: 'exact' })` calls in `SuperAdminDashboard`

Lines 195–202: 7 parallel `count: 'exact'` queries on `organizations`, `inspections`, `notifications_log`, `sync_conflicts`, `trainings`, `daily_assessments`. With `head: true` they don't return rows, but `count: exact` still does a full scan.

Switch to `count: 'estimated'` (uses `pg_class.reltuples`, near-instant) for the dashboard tiles. Keep `exact` only where the user needs the precise number.

**Expected impact:** Eliminates ~6 full-table scans per super-admin dashboard load.

## Phase 2 — Client-side, low risk (next)

### 2.1 Narrow `select('*')` on the big read paths

Three files dominate read I/O:
- `src/pages/InspectionForm.tsx` — 6 `.select("*")` calls loading the form
- `src/pages/DailyAssessmentForm.tsx` — 6 child table `.select('*')` calls
- `src/pages/TrainingForm.tsx` — 6 child table `.select('*')` calls
- `src/components/PhotoGallery.tsx:296` — already loads photo records with `*`

Replace `*` with explicit column lists matching the fields actually consumed by each form. Particularly important for tables with rich-text/JSON columns (notes, summaries) which bloat row size.

**Expected impact:** ~30–50% reduction in row-fetch bytes per form open. Lower disk read budget consumption per dashboard render.

### 2.2 Reduce realtime channel fanout in `Dashboard.tsx`

Lines 654–684 subscribe to `postgres_changes` on inspections, trainings, daily_assessments — with no filter. Every write by every user triggers your client to receive an event and (per `useAutoSync`) potentially trigger a refetch.

Add `filter: \`inspector_id=eq.${userId}\`` (or org-scoped equivalent) so the client only receives events for rows it can actually see. Server still does the work but fewer client roundtrips → fewer downstream refetches → less DB read pressure.

**Expected impact:** Major reduction in realtime-triggered refetch storms when multiple inspectors are active.

### 2.3 Audit the 35 setInterval loops

Several are reasonable (auto-save, periodic sync). Two stand out as candidates to lengthen or condition:
- `useStorageHealthCheck.tsx:24` — every 10s
- `useAutoSync.tsx:1183, 1214` — periodic sync; already has idle/active distinction but `MIN_SYNC_INTERVAL = 2s` is aggressive
- `useNotificationCenter.tsx:39` — interval not visible in this scan, worth checking

I will not change `useAutoSync` intervals without explicit approval — your `Unsynced Counts Coalescer` and `Sync Terminal Error Classification` memories show this code is heavily tested and risky to retune. I'll only flag what I find for your review.

## Phase 3 — Defer (only if Phase 1+2 don't move the needle)

- Materialized counts for the dashboard tiles (rebuild every N minutes via cron).
- Move audit_logs to a partitioned table (currently 67k rows growing fast).
- Add covering indexes for the most-hit `inspector_id + status + deleted_at` queries on the three report tables.

These are bigger changes; only worth it if the cheap wins above don't get you under budget.

## What I will NOT touch in this plan

- `atomic-sync-manager.ts` — sync ID transformation, deduplication, restore lock all per memory
- `offline-storage.ts` — IDB photo path, `relinkPhotosToNewInspectionId`
- `useAutoSync.tsx` core sync loop (only flagging intervals)
- Photo capture / HEIC pipeline
- Auth state machine, storage pressure handlers, RLS soft-delete logic

Per your project memory rules, those areas need explicit approval before I edit.

## Heads-up: pre-existing TypeScript build errors

The build harness reports ~30 TS errors in `useAutoSync.tsx`, `DailyAssessmentForm.tsx`, `useFormConfiguration.tsx`, `DataRecoveryTool.tsx`, `PushNotificationManager.tsx`, `photo-cache.ts`. These exist *before* this plan and appear to stem from stale generated `types.ts` vs. current schema. They don't block the SQL migrations but I recommend a separate session to regenerate types and clean these up — they're masking type-safety on sync paths.

## Order of operations

1. Approve plan.
2. I write migration 1.1 (`user_roles` indexes) — measure 24h disk I/O.
3. I write migration 1.2 (`skip_noop_update` triggers) — measure another 24h.
4. If still over budget, proceed to Phase 2 client-side narrowing.
5. Only consider the upgrade after these are in.

Estimated effort: Phase 1 is ~2 small migrations and one 4-line client edit. Phase 2 is 3–4 focused PRs.
