

## C2 — Stop the empty-local-guard from silently restoring server child rows

### Finding

`atomic-sync-manager.ts` has a "recovery" branch in all three sync paths (inspection ~L686-708, training ~L1568-1584, daily-assessment ~L2380-2396) that fires when **server has child data AND local is empty AND `wasClearedAfterLastSync()` is false**. It pulls every server child row back into IndexedDB (`saveRelatedDataOffline` / `saveTrainingDataOffline` / `saveAssessmentDataOffline`) and stamps `synced_at = updated_at = serverTimestamp` so nothing looks dirty.

The form-level `reconcileClearIntent` correctly stamps `user_cleared_at` when an autosave runs *after* the last row is removed — but there are real windows where it doesn't:

- An autosave that emptied a section is still in flight (debounced) when the next sync cycle picks the record up.
- A rare IDB read returns empty for one section while the others are also empty (legitimate state but the marker was never restamped because nothing changed).
- Cross-tab edits where one tab clears and another tab triggers sync before the marker is persisted.

In every one of those cases the recovery branch silently restores server data. From the user's perspective, "rows I deleted came back" — and worse, any local edits to those child rows are overwritten by the server copy.

The "skip sync" half of the guard (`return { skipped: true, reason: 'empty_local_guard' }`) is correct and should stay. Only the **automatic IDB restore** is the problem.

### Fix

Convert the recovery branch from "auto-restore IDB" into "skip + surface a held-back conflict the user can resolve." Reuse the S39 plumbing that already surfaces held-back records in `SyncDiagnosticsSheet`.

**1. New module `src/lib/empty-local-conflict-store.ts`** (mirrors `regression-skip-store.ts` shape):

```ts
export interface EmptyLocalConflictEntry {
  id: string;                              // parent record id
  reportType: 'inspection' | 'training' | 'daily_assessment';
  detectedAt: number;
  serverCounts: Record<string, number>;    // section name → row count
  organizationLabel?: string;              // best-effort, for UI
}

// IDB-backed (sync_empty_local_conflicts store, 30-day TTL, hot cache).
export async function recordEmptyLocalConflict(entry: EmptyLocalConflictEntry): Promise<void>;
export async function listEmptyLocalConflicts(): Promise<EmptyLocalConflictEntry[]>;
export async function clearEmptyLocalConflict(id: string): Promise<void>;
```

Add a one-line upgrade in `offline-storage.ts` to create the new object store on the next IDB version bump (or piggy-back on the next version that's already pending — match the same pattern S39 used for `sync_regression_counters`). Until the upgrade lands, `getDB()` returns null and recording is a no-op (matches the existing tolerant pattern in `regression-skip-store.ts`).

**2. Replace the auto-restore in three places.** The new branch:

- Removes the `await Promise.all([saveRelatedDataOffline(...), ...])` block.
- Removes the `saveInspectionOffline({ ...inspection, synced_at: aligned, updated_at: aligned })` re-stamp.
- Calls `recordEmptyLocalConflict({ id, reportType, detectedAt: Date.now(), serverCounts: {...} })`.
- Pushes a notification via `addSyncNotification('Sync paused: <Org> — local empty but server has data. Open Sync Diagnostics to resolve.', 'high')` (de-duped on `id` so repeated cycles don't spam).
- Still returns `{ skipped: true, reason: 'empty_local_guard' }`.

The existing `wasClearedAfterLastSync(...)` short-circuit stays — legitimate "user cleared everything" still flows through normally to delete server rows on the next reconcile.

**3. Surface the conflicts in `SyncDiagnosticsSheet.tsx`** — new section beneath "Held-Back Records":

```
Empty-Local Conflicts (N)
─────────────────────────
Acme Corp — Inspection
Local cache is empty but server has 12 systems, 3 ziplines, 5 equipment.
Detected 2 minutes ago.

[ Restore from server ]   [ Confirm local empty ]   [ Dismiss ]
```

Three actions:
- **Restore from server** — pulls server children into IDB (the *current* recovery behavior, but now opt-in). Calls existing `saveRelatedDataOffline` + re-stamp logic, then `clearEmptyLocalConflict(id)`.
- **Confirm local empty** — calls `markUserCleared(parent)` + `saveInspectionOffline` (or training/assessment equivalent), bumps `updated_at`, then `clearEmptyLocalConflict(id)`. Next sync cycle will see `wasClearedAfterLastSync === true` and proceed to delete server rows via the normal reconcile path.
- **Dismiss** — just clears the conflict entry; sync will re-detect on the next cycle if the condition still holds.

Wire the three handlers to existing helpers (`saveRelatedDataOffline`, `saveTrainingDataOffline`, `saveAssessmentDataOffline`, `markUserCleared`, the per-type `saveXOffline`).

**4. Notification de-dupe.** `addSyncNotification` is called from the sync path on every cycle that hits the guard. Add a small in-module `Set<string>` keyed on parent id; only fire the toast when the id isn't already present, and clear it inside `clearEmptyLocalConflict`. Matches S39's "fire once per detection" UX.

### Out of scope

- Touching the form-level `reconcileClearIntent` calls — they already handle the happy path.
- Touching the `wasClearedAfterLastSync` short-circuit.
- The "SUSPICIOUS EMPTY GUARD" block that follows each recovery branch (it only fires when *both* local and server are empty — different code path, no data-loss risk).
- The pre-delete backup in the soft-delete branch (different concern).
- Auto-merging server children with local edits — out of scope for C2; the surfaced conflict gives the user a clear choice instead of guessing.

### Risk

Low–medium. The change is strictly a removal of an automatic write + addition of a user-visible queue. Worst case: a user with the condition has to click a button instead of having it silently "fix" itself — which is exactly the design goal.

The IDB store-creation upgrade is the only new schema touch; it follows the exact pattern that `sync_regression_counters` (S39) uses, so the migration-safety machinery already covers it.

### Verification

- `npx tsc --noEmit`.
- DEV scenario A (the bug): with a previously-synced inspection that has 5 systems on the server, manually clear `inspection_systems` from IDB *without* stamping `user_cleared_at`. Trigger sync. Expect: console `[SAFETY] empty_local_guard` warning, **no** `[SAFETY] Recovering` line, **no** server rows pulled back into IDB, sync notification "Sync paused: <Org> — local empty but server has data" appears, `SyncDiagnosticsSheet` shows the entry under "Empty-Local Conflicts (1)".
- DEV scenario B (legitimate clear): in the inspection form, delete every system/zipline/equipment/standard. Wait for autosave. Trigger sync. Expect: `wasClearedAfterLastSync === true` short-circuit fires, server rows are deleted via reconcile path, **no** conflict entry appears.
- DEV scenario C (recovery action): from scenario A's state, click "Restore from server" in the diagnostics sheet. Expect: server child rows reappear in IDB and in the form, conflict entry disappears, next sync runs cleanly.
- DEV scenario D (confirm-empty action): from scenario A's state, click "Confirm local empty". Expect: `user_cleared_at` is stamped, conflict entry disappears, next sync deletes server rows via reconcile, server is now empty.
- Repeat A–D for trainings and daily assessments.

