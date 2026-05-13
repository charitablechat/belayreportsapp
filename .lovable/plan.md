## What's going on

"Airiel Crawler World" (an Assessment, not a Crawler report) was already soft-deleted on the server on April 24, 2026 (`daily_assessments.id = c24b6198-4a5f-4541-ad0c-825b27f3bdc0`). It's stuck on this device only — IndexedDB still holds a dirty copy and keeps trying to sync it, so it shows in **PENDING REPORTS (1)** in the Sync Terminal. Because the server row is `deleted_at IS NOT NULL`, the sync push round-trips with no progress and the local copy never clears.

There's no source-code reference to "Airiel Crawler World" — it's pure user data.

## Plan

### 1. One-time hard-delete on the server
Permanently remove the soft-deleted assessment row and any child rows (so it can never resurrect into anyone's device on a restore):
- `daily_assessments` row `c24b6198-4a5f-4541-ad0c-825b27f3bdc0`
- Any related `daily_assessment_*` child rows / photos via cascade

Done via a one-shot migration.

### 2. Auto-reconcile server-deleted records on push (the real fix)
Update the assessment push path in `src/lib/sync-manager.ts` so that when an `UPDATE` to `daily_assessments` returns "row not found" or the row has `deleted_at IS NOT NULL`, the local IDB copy is dropped instead of being retried forever. Mirror the same guard for `inspections` and `trainings` push paths so this class of "ghost pending" can't recur.

### 3. Per-row DROP control in Sync Terminal (escape hatch)
In `src/components/pwa/SyncPulse.tsx`, add a small `DROP` button on each row inside **PENDING REPORTS** (next to INS / TRN / ASM). Tapping it:
- Confirms once (`window.confirm("Discard this local draft? It cannot be recovered.")`)
- Deletes the local IDB record from the matching store
- Refreshes the unsynced counts

This lets the user clear any future stuck draft without waiting on us.

## Out of scope
- IndexedDB open/wedge logic (separate issue, already handled by RECOVER STORAGE)
- Photo retry buckets
- RLS / auth

## Files
- `supabase/migrations/<new>.sql` — hard-delete the one ghost row
- `src/lib/sync-manager.ts` — auto-purge local on server-side delete
- `src/components/pwa/SyncPulse.tsx` — per-row DROP button
- `src/lib/offline-storage.ts` — small helper `deleteLocalRecord(table, id)` if one doesn't already exist
