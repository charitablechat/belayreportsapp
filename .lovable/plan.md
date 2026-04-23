

## Gap 2.1 — Surface IDB save failures to callers

### Problem

`withIndexedDBErrorBoundary` (`src/lib/offline-storage.ts:719-853`) is a one-size-fits-all wrapper. On error it logs, shows a destructive toast, and `return fallbackValue` — for the three user-facing report saves (`saveInspectionOffline`, `saveTrainingOffline`, `saveDailyAssessmentOffline`) `fallbackValue` is `undefined`. Callers `await` the call, get `undefined`, and treat it as success: clear "unsaved changes", advance `lastSavedAtRef`, append a version. The destructive toast flashes for ~3s but the form UI says "Saved". Navigate away → data lost.

The same hazard exists for the localStorage emergency-fallback path: today it returns `fallbackValue` even when **both** IDB and localStorage failed — caller still sees success.

### Solution: a strict save boundary that throws

Mirror the existing `withIndexedDBReadBoundary` / `IDB_READ_FAILED` pattern (already in the file at lines 612-715) but for writes. Don't change the silent boundary's signature — too many callers depend on it. Instead, add a parallel strict wrapper used only by the three user-facing saves.

#### 1. New helper: `withIndexedDBSaveBoundary<T>(operation, operationName)`

In `src/lib/offline-storage.ts`, immediately after `withIndexedDBErrorBoundary`:

- Same circuit-breaker / health-check / timeout / failure-recording logic as the silent wrapper (copy the structure, do not refactor — keeping them parallel makes future audits trivial).
- **Differences:**
  - No `fallbackValue` parameter.
  - On circuit-breaker-open: attempt `emergencyLocalStorageFallback`. If it succeeds, **return a tagged success object** `{ savedToBackup: true }` so the caller knows the row is in localStorage, not IDB. If it fails, **throw** `new IdbSaveError('storage_unavailable', operationName)`.
  - On timeout: throw `new IdbSaveError('timeout', operationName)` after the existing connection reset.
  - On health-check failure: throw `new IdbSaveError('idb_unhealthy', operationName)`.
  - On caught error: keep the existing QuotaExceededError toast, then **throw** `new IdbSaveError('quota_exceeded' | 'unknown', operationName, originalError)`.
  - On success: `recordIndexedDBSuccess()` and return the operation's result (or `{ savedToBackup: false }` for void operations).

- Export a small `IdbSaveError` class with `code`, `operationName`, `cause` fields and an `isIdbSaveError(e): e is IdbSaveError` type guard, both exported alongside `IDB_READ_FAILED`.

#### 2. Wire the three user-facing saves through it

Switch `saveInspectionOffline`, `saveTrainingOffline`, `saveDailyAssessmentOffline` (lines 1202-1237, 2848-2870, 2505-2527) from `withIndexedDBErrorBoundary(... undefined, 'name')` to `withIndexedDBSaveBoundary(... 'name')`. Their public signature changes from `Promise<undefined>` to `Promise<{ savedToBackup: boolean }>` and they now reject on hard failure.

No other functions move — read paths, queues, photo helpers, deletion helpers, etc. all keep the silent wrapper. They are not in the data-loss path the user described.

#### 3. Update callers to honor rejections

There are roughly a dozen callers across the form auto-save hooks and page components. The pattern at every call site becomes:

```ts
try {
  const res = await saveInspectionOffline(...);
  // success — clear unsaved, advance lastSavedAtRef, appendVersion()
  if (res?.savedToBackup) {
    // optional: set a soft "saved to backup storage" indicator
  }
} catch (err) {
  if (isIdbSaveError(err)) {
    // KEEP unsaved-changes flag set
    // KEEP lastSavedAtRef unchanged
    // SKIP appendVersion()
    // surface persistent (non-auto-dismiss) error in the existing AutoSaveIndicator
    setSaveError(err);   // new local state in the autosave hook
  } else {
    throw err; // never swallow unknown errors
  }
}
```

Concretely the touched files are:
- `src/pages/InspectionForm.tsx` — autosave + "save before leave" call sites.
- `src/pages/TrainingForm.tsx` — same.
- `src/pages/DailyAssessmentForm.tsx` — same.
- `src/pages/NewInspection.tsx`, `src/pages/NewTraining.tsx`, `src/pages/NewDailyAssessment.tsx` — initial "create draft" save paths.
- `src/hooks/useEmergencySave.tsx` — must propagate failure so beforeunload knows the queued write failed.
- `src/lib/admin-edit-snapshot.ts` and `src/lib/admin-edit-snapshot-queue.ts` (if they call any of the three saves; verify with grep, adjust only if so).

For each call site:
- Wrap in try/catch using `isIdbSaveError`.
- On error: do **not** clear the dirty flag, do **not** update `lastSavedAtRef`, do **not** call `appendVersion()`, do **not** mark the form "Saved".
- Surface the failure persistently. Use the existing `AutoSaveIndicator` — extend it with an `error` prop that shows a red, non-auto-dismissing "Save failed — your changes are not stored. Tap to retry." chip wired to a manual save handler.

#### 4. Strengthen the `useUnsavedChanges` save-and-leave path

`useUnsavedChanges.saveAndLeave()` (`src/hooks/useUnsavedChanges.tsx:73-89`) currently swallows any `onSaveAndLeave` rejection in a console.warn and proceeds with `navigate(fallbackPath)` — which would silently discard data on IDB failure too. Change it to:
- Re-throw the error (or return a `{ ok: false, reason }`) so the dialog component can show "Save failed — stay on page or discard?" instead of navigating away.
- Update `SaveBeforeLeaveDialog` (and any other consumer) to handle that branch by keeping the user on the page with the persistent save error visible.

#### 5. `appendVersion` / version manager

`appendVersion` in `src/lib/report-version-manager.ts` is invoked after a successful save. No change needed there as long as callers stop invoking it on failure (handled in step 3). A short comment at the top of `appendVersion` noting "MUST only be called after a confirmed successful save" prevents regressions.

#### 6. Tests

Extend `src/lib/__tests__/sync-hardening.test.ts` (or add `offline-storage-save-boundary.test.ts` next to `offline-storage-guards.test.ts`):
- Save throws `IdbSaveError('idb_unhealthy')` when health check fails.
- Save throws `IdbSaveError('quota_exceeded')` and the wrapper does **not** swallow.
- Save returns `{ savedToBackup: true }` when circuit breaker is open and emergency localStorage write succeeds.
- Save throws `IdbSaveError('storage_unavailable')` when both IDB and localStorage fail.

### Out of scope

- No changes to read boundaries or non-user-facing writes (queues, dead-letter stores, photo helpers, etc.). They keep the silent wrapper — their failure modes are already surfaced through other channels (sync diagnostics, dead-letter UI from Fix 1.C).
- No DB schema changes. No edge function changes. No memory updates required (this hardens the existing local-first-data-integrity invariant rather than introducing new architecture).

### Files touched

- `src/lib/offline-storage.ts` — add `IdbSaveError`, `isIdbSaveError`, `withIndexedDBSaveBoundary`; switch three save functions.
- `src/pages/InspectionForm.tsx`, `src/pages/TrainingForm.tsx`, `src/pages/DailyAssessmentForm.tsx`, `src/pages/NewInspection.tsx`, `src/pages/NewTraining.tsx`, `src/pages/NewDailyAssessment.tsx` — try/catch + don't clear dirty on error.
- `src/hooks/useEmergencySave.tsx` — propagate failure.
- `src/hooks/useUnsavedChanges.tsx` + `src/components/SaveBeforeLeaveDialog.tsx` — refuse to navigate when save-and-leave fails.
- `src/components/AutoSaveIndicator.tsx` — persistent error state with manual retry.
- `src/lib/report-version-manager.ts` — comment only.
- New test file under `src/lib/__tests__/`.

