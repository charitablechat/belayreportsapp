

## Plan — H2 + C1 in `importBackupZip` restore path

The ZIP-import restore (`local-backup-ledger.ts:importBackupZip`) bypasses both safety nets that the admin/cloud restore handlers already use. We close the three gaps the audit flagged for this path.

### Changes

**1. `src/lib/restore-integrity.ts` (new)** — extract `verifyRestoreIntegrity` from `DataRecoveryTool.tsx` into a shared module. Same signature, same behaviour. `DataRecoveryTool.tsx` re-imports it (zero behavioural change to the existing two call sites).

**2. `src/lib/local-backup-ledger.ts:importBackupZip`** — H2 + C1 + integrity:
- Import `withRestoreLock` from `@/lib/restore-lock` and wrap **all** post-validation work (steps 1–5: localStorage write, IDB writes, photo import, cloud upload, event dispatch) in `await withRestoreLock(async () => { … })`. This blocks `useAutoSync.performSync` from racing the restore (same guarantee admin/cloud handlers already have).
- C1 fix at line 643: replace `uploaded: false` with `uploaded: toUploadedFlag(false)` (import the helper from `@/lib/offline-storage`). Per the contract, photo writes must funnel through `toUploadedFlag` so the `by-uploaded` index keys the row on spec-strict browsers (Safari).
- After the IDB parent write (inside the lock, before photo import), call `verifyRestoreIntegrity(reportType, reportId, snapshot.parent, async () => { /* re-call the appropriate save*Offline */ })` so any drift on `organization` / `location` / `site` / `status` / `updated_at` triggers a single re-apply — matches the existing handlers.

**3. `src/lib/__tests__/import-backup-zip-restore.test.ts` (new)** — fake-indexeddb based:
- Photo C1 contract: import a synthetic ZIP with one photo, then assert `getUnuploadedPhotos()` returns the row (proves `uploaded` landed as `0`, not `false`).
- Restore-lock contract: spy on `isRestoreInProgress()` during a long-running mock `saveInspectionOffline` to confirm the lock is held for the duration.
- Integrity re-apply: pre-seed IDB with a parent that has `status: 'completed'`, run `importBackupZip` whose snapshot says `status: 'in_progress'`, mock the IDB read post-write to return the stale `'completed'` row, assert the re-apply path fires.

**4. Memory refresh**
- `mem://architecture/restore-lock` — add `importBackupZip` to the list of restore handlers wrapped by `withRestoreLock` + `verifyRestoreIntegrity`.

### Out of scope (acknowledged in audit)

- H3 (`reconcileAllChildTables` outside transaction) — already fixed by deferred-reconcile per existing memory; no new work.
- `empty_local_guard` server-pull behaviour and Realtime cross-device parent persistence — separate plan.
- Temp-ID → existing-server-UUID adoption — separate plan.
- 18 `verify_jwt = false` edge functions — confirmed count; user noted out of scope.
- The unused-`isUnsafeToTransmit` claim is **stale** — `assertRealSessionForSync` calls it from all three sync entry points. No action.

### Files touched

- `src/lib/restore-integrity.ts` (new — extracted helper)
- `src/components/admin/DataRecoveryTool.tsx` (replace local `verifyRestoreIntegrity` with import; both call sites unchanged)
- `src/lib/local-backup-ledger.ts` (wrap in `withRestoreLock`, C1 coercion at line 643, post-write integrity check)
- `src/lib/__tests__/import-backup-zip-restore.test.ts` (new — 3 tests)
- `mem://architecture/restore-lock.md` (refresh)

