

## Verification follow-ups — status check

Three items called out in your spot-check verdict. Current state in the codebase:

### C2 — `getUnsyncedCounts` participation
**Already resolved.** The batched `getUnsyncedCounts` was deleted as part of the earlier C2 fix. `useAutoSync.updateUnsyncedCounts` now calls `getUnsyncedInspections`, `getUnsyncedTrainings`, `getUnsyncedDailyAssessments` in parallel via `Promise.all`, each returning `IdbReadFailure` through `withIndexedDBReadBoundary`. No remaining all-empty fallback path. No work needed.

### C3 — drift race
**Already resolved.** `saveInspectionOffline` (and the training / assessment equivalents) stamps `dirty: true` on every local write, and `getUnsynced*` treats `dirty=true` as overriding the drift comparison. Boundary test `unsynced-read-boundary.test.ts` locks the contract: a record with `synced_at == updated_at` (zero drift) still surfaces when `dirty=true`. No work needed.

### Tests — "No unit tests for any of the above"
**Already resolved.** `src/lib/__tests__/unsynced-read-boundary.test.ts` (logged in `mem://architecture/sync-boundary-test-coverage`) covers, against a real `fake-indexeddb`:
- Empty store → `[]`, not `IdbReadFailure`.
- 29s drift → synced; 31s drift → unsynced.
- `dirty=true` overrides zero drift.
- `_remote_deleted_at` quarantined rows excluded.
- Cross-user temp-id orphans still surface.
- `saveInspectionOffline` stamps `dirty=true` so next read sees the edit.
- `photos.by-uploaded` index uses `0|1` (C1 contract).

Plus `drift-tolerance-override.test.ts` for the P4 override and `local-data-guards.test.ts` for the boundary helpers.

### Verdict

All three follow-ups from the spot-check are already shipped. No code changes required. If you want a deeper test (e.g. integration coverage of `useAutoSync.updateUnsyncedCounts` handling a mixed success/`IdbReadFailure` triple, which the current suite does NOT cover), say the word and I'll plan that out separately.

