

## Final gap closure: 3 client gaps + 1 server safety net

After the V4–V8 work, four real gaps remain. Two are client-side oversights from the previous pass, one is a hidden cascade vector via the cron job, and one is the server-side belt-and-braces.

### Gap A — `cloud-backup.ts` restore is completely unprotected

`restoreSnapshotToServer` (lines 276–292) deletes existing children for every table in the snapshot, **including when `rows.length === 0`** (comment literally says "even if snapshot has zero rows"). No tripwire, no empty-array guard, no pre-restore safety snapshot. This is super-admin-only but it's a one-click button that can wipe every child row of a report if the snapshot was captured during a bad IDB read.

**Fix:** mirror the `admin-edit-snapshot.ts` pattern exactly:
- Skip the delete when `rows.length === 0` (preserve current server data, log warning)
- Capture a `pre_restore` `admin_edit_snapshots` row before the operation
- Route the per-table delete through `assertSafeToDeleteChildRows` with `context: { bulk: true, source: 'cloud_restore' }`

### Gap B — `transaction-manager.ts` forward-step `delete` is not tripwired

Line 101: `result = await withStepTimeout((supabase as any).from(step.table).delete().match(step.filter), ...)`. This is the *forward* delete step (not the rollback). Only the rollback at line 199 was tripwired in the previous pass. Any transaction that includes a child-table delete as a forward step bypasses the tripwire entirely.

**Fix:** before the forward-step delete, fetch the matching row IDs and pass them through `assertSafeToDeleteChildRows` with `context: { bulk: true, source: 'tx_forward_delete' }`. If blocked, throw to roll the transaction back.

### Gap C — `useEmptyReportCleanup` can soft-delete a non-empty report based on a bad local read, leading to cascade purge in 60 days

The hook decides "empty" from the in-memory state. If the form mounted while IDB was returning `[]` due to the 5s timeout (which we know happens — 269 suppressed warnings in console), the hook can mark a real report as empty → soft-delete sets `deleted_at` → after 60 days `cleanup_expired_deleted_records()` runs `DELETE FROM public.inspections WHERE …` → `ON DELETE CASCADE` on every child FK wipes every child row. **The 60-day window means this damage shows up months after the bug.**

**Fix:** before issuing the soft-delete, do a single round-trip count query against the parent's child tables on the server. If any child table has `count > 0`, abort the soft-delete and log a warning. Cheap (one head-only count per table), runs only at form-unmount when "empty" is detected, fully prevents the bad-read-→-soft-delete-→-cascade-purge chain.

### Gap D — Server-side `BEFORE DELETE` trigger on every child table

The single permanent fix that closes everything else, including:
- Stale PWA versions still in production (the published `4.6.7` has none of our guards)
- Direct API calls (Postman, curl, future edge functions, future migrations)
- The `cleanup_expired_deleted_records` cron's cascade chain (if a parent is mistakenly purged, the trigger refuses the cascade child-deletes that would wipe >70% in one statement)
- Any future code regression

**Implementation:**
- New migration: `protect_child_row_mass_delete()` PL/pgSQL trigger function. For each affected child table, on `BEFORE DELETE` for each row, increment a per-statement counter via a temporary GUC `app.delete_count_<table>_<parent_id>`. After the statement, compare to total row count for that parent — if dropping >70% in one statement, raise exception unless session GUC `app.bulk_delete_opt_in = 'true'` is set.
- Simpler alternative (recommended): use a `BEFORE DELETE … FOR EACH STATEMENT` trigger that compares `count(*) FROM <table> WHERE fk IN (SELECT fk FROM old_table)` with `count(*) from old_table`. If ratio per parent >70%, raise unless `current_setting('app.bulk_delete_opt_in', true) = 'true'`.
- Apply to: `inspection_systems`, `inspection_ziplines`, `inspection_equipment`, `inspection_standards`, `inspection_summary_*`, `training_*` child tables, `daily_assessment_*` child tables, `photos` (parent_type/parent_id-scoped).
- Update legitimate bulk callers (`admin-edit-snapshot.ts`, `cloud-backup.ts`, `transaction-manager.ts` rollback) to issue `SET LOCAL app.bulk_delete_opt_in = 'true'` via an `rpc('set_bulk_delete_opt_in')` helper before their delete batch.
- Add a small SECURITY DEFINER function `set_bulk_delete_opt_in()` that callers invoke; it `SET LOCAL`s the GUC for that connection's transaction only.
- The `cleanup_expired_deleted_records` function itself should NOT set the opt-in — that way if a parent was mistakenly soft-deleted, the cascade is blocked at the trigger level and surfaces as a visible error rather than silent data loss.

### Files to change

- `src/lib/cloud-backup.ts` — Gap A
- `src/lib/transaction-manager.ts` — Gap B
- `src/hooks/useEmptyReportCleanup.tsx` — Gap C (add server-side child-count verification)
- NEW `supabase/migrations/<timestamp>_child_row_mass_delete_guard.sql` — Gap D
- `src/lib/admin-edit-snapshot.ts` — call new `set_bulk_delete_opt_in` rpc before its deletes
- `src/lib/cloud-backup.ts` — same opt-in call
- `src/lib/transaction-manager.ts` — same opt-in call before rollback bulk deletes

### Verification

1. Cloud restore with an empty snapshot table: server children preserved, warning logged, pre_restore snapshot captured.
2. Forward `tx step.type === 'delete'` against a child table with >70% match: tripwire blocks, transaction rolls back.
3. Form mounts with IDB read returning `[]` for a real report; user navigates away; `useEmptyReportCleanup` queries server, sees children, aborts the soft-delete.
4. Manual `delete from inspection_systems where inspection_id = '<id>'` in SQL editor (without setting the GUC) on a parent with ≥3 rows: trigger raises `child_row_mass_delete_blocked`. Re-run after `select set_bulk_delete_opt_in()`: succeeds.
5. Stale `4.6.7` PWA on a real device tries the old reconciler over-prune path: server trigger blocks the delete, sync logs an error, no data lost.

### Risk

- **Trigger overhead:** ~1ms per delete statement (one count query per affected parent). Child-table deletes are rare; impact negligible.
- **Migration coordination:** the trigger goes live before all clients update. Existing legitimate bulk paths (admin restore, cloud restore, tx rollback) need the opt-in RPC shipped *in the same release* so they don't start failing. Migration script ordering: deploy code first, then migration.
- **Cascade from hard-delete of a parent:** the cleanup cron deliberately does NOT opt in, so if a parent is mistakenly hard-deleted with rich children, the trigger raises. The cron will log the failure to its own job output; we'll surface this in `SyncDiagnosticsSheet` via a new "Server-side delete blocks (24 h)" row from `postgres_logs` (read-only via existing analytics_query infra).

### Out of scope

- Reworking the LWW/field-merge model.
- Replacing the soft-delete retention period.
- Anything in `notification_*` / `push_subscriptions` / `user_field_history` / `onboarding_progress` deletes — these are user-scoped admin/state tables, not report child rows.

