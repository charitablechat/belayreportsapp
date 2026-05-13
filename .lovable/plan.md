# Why the previous fix didn't take

Two things conspired:

1. **DROP button can't reach the record.** When the IDB layer breaker is OPEN (which it is right now — every recent log line says `Layer breaker open…`), `deleteOfflineDailyAssessment(id)` falls through to the localStorage fallback path. But the real "Airiel Crawler World" row lives in **IndexedDB**, not localStorage. The delete silently no-ops, the row survives the next breaker reset, and PENDING REPORTS still shows 1.
2. **The screenshot row has no DROP control.** The note "Local data unreadable — refreshing may help" indicates the counts read failed and `useAutoSync` is showing the **last-known** `unsyncedAssessments` array. The row is rendering through a code path that doesn't include the new DROP button (likely a stale bundle on the iPad, or the read-failure stub render). Either way, the user can't tap their way out.
3. **Even if DROP worked, the auto-reconcile on push from the previous round wasn't actually wired** — push for `daily_assessments` doesn't currently treat `deleted_at IS NOT NULL` server rows as "drop local". So as soon as the breaker closes, the next sync round-trip re-discovers the ghost and re-displays it.

# Plan

### 1. Make DROP work even when the layer breaker is open
In `src/lib/offline-storage.ts`, add a new exported helper:
```
forceDeleteLocalRecord(table: 'inspections'|'trainings'|'daily_assessments', id: string)
```
that:
- Tries the normal IDB delete first (1.5s timeout).
- On timeout / breaker-open, **directly opens a short-lived `idb.openDB` connection** that bypasses the layer-breaker gate (purpose: surgical delete only) and removes the row from the matching store + any sibling per-table caches (e.g. `dailyAssessmentItems`, photos by parent id).
- Also purges any matching `localStorage` emergency-save key (`emergency:daily_assessment:<id>` etc.).
- Returns `{ deletedFromIdb, deletedFromLocalStorage }` so the UI can show what cleared.

Wire `SyncPulse.tsx`'s three `onDrop` handlers to this new helper instead of the current `deleteOffline*` calls.

### 2. Always render DROP, even on the read-failure stub row
`src/components/pwa/SyncPulse.tsx` already has `PendingReportRow`. The fix:
- Remove the conditional that suppresses the row when `unsyncedAssessments` came from a stale snapshot.
- Render a `DROP` button on **every** pending row regardless of breaker state. The new `forceDeleteLocalRecord` is the one that decides how to actually purge; the UI just calls it.
- After a successful drop, `forceSync({ refreshCountsForce: true })` and toast `"Local draft discarded."`.

### 3. Auto-reconcile server-deleted records on push (the real long-term fix)
In `src/lib/sync-manager.ts`, around the `daily_assessments` UPDATE push:
- Before pushing, do a `select id, deleted_at from daily_assessments where id = $1`.
- If row missing, or `deleted_at IS NOT NULL`, call `forceDeleteLocalRecord('daily_assessments', id)` and skip the push for this row.
- Mirror the same guard for `inspections` and `trainings`.

This guarantees future "ghost pending" can never recur from this class of cause.

### 4. One-shot purge of the known ghost on next boot
Add a tiny migration in `src/lib/offline-storage.ts` boot path: if a `daily_assessments` row with id `c24b6198-4a5f-4541-ad0c-825b27f3bdc0` exists locally on this device, call `forceDeleteLocalRecord` and log a one-line breadcrumb. Self-deleting after one run via a flag in `localStorage` (`__purged_airiel_v1=true`).

## Files
- `src/lib/offline-storage.ts` — add `forceDeleteLocalRecord` + boot-time one-shot purge
- `src/lib/sync-manager.ts` — push-side server-deleted reconcile for all 3 tables
- `src/components/pwa/SyncPulse.tsx` — wire DROP to new helper, always render it

## Out of scope
- IDB layer-breaker rework (separate audit)
- Photo retry buckets
- Auth / RLS

## Expected user experience after this ships
- Open Sync Terminal → tap **DROP** next to "Airiel Crawler World" → row disappears within ~1s, even with breaker open.
- If the user does nothing, the next time the breaker closes and a sync runs, the push-side reconcile silently purges it.
- On the very next app boot, the one-shot migration also purges it as a belt-and-braces safety net.
