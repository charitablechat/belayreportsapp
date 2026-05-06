## Root cause (revised)

The plan's original Fix #1 (guard refetch against in-flight edits) is **already implemented** — `useFormRecordRealtime.onUpdate` and the `onPendingRemoteUpdate` toast in all three forms early-return on `hasUnsavedRef`, and tracked-field merge already runs in `atomic-sync-manager`. So that's not the active bug.

The real race is in **`loadInspection()`** (and its Training/DailyAssessment twins):

1. User types into Onsite Contact → 500 ms debounce scheduled, `hasUnsavedChanges=true`, but the IDB write hasn't fired yet.
2. Some path calls `loadInspection()` (initial mount on a stale tab, "Reload" toast, app resume, channel-degraded fallback).
3. `loadInspection` reads `offlineData` from IDB — which is the **pre-edit row** because the debounce hasn't flushed.
4. `localIsNewer` evaluates against stale IDB → false → "server is current" branch runs `setInspection(data)` → in-memory edit is wiped.

Same mechanism kills photos: `PhotoGallery` re-reads from IDB; if a read fails (the 631 suppressed 8 s timeouts you're seeing) it renders empty instead of preserving the last-known list.

## Fix

### 1. Flush-before-load in `loadInspection`
Inspection / Training / DailyAssessment forms — at the top of `loadInspection`:
- If `saveDebounceTimerRef.current` is set OR `hasUnsavedRef.current` is true, `await performSaveRef.current?.(true)` first, then continue. This ensures the IDB row read by `getInspectionOffline(id)` already contains the pending edit.

### 2. Per-field merge when applying server data
In every `setInspection(data)` / `setAssessment(data)` / `setTraining(data)` call inside `loadInspection`, replace the raw assignment with `mergeRecordFields(currentInMemory, serverData, TRACKED_FIELDS.<kind>)`. If the user edited Onsite Contact 200 ms ago and `field_timestamps.onsite_contact` is newer than server's, the local value wins. Untracked fields (status, inspector_id, latest_report_html, …) still come from server.

Also apply the same merge on the explicit "Reload" toast action.

### 3. PhotoGallery: preserve last-known on IDB read failure
`src/components/PhotoGallery.tsx` — wrap the photo-list read with `isIdbReadFailure` detection (mirror `useUnsyncedPhotos`). On failure, keep the previously rendered list in a ref instead of re-rendering empty. Union pending photos (`uploaded === 0`) with server photos so an in-flight upload never disappears between reads.

### 4. One-shot diagnostics on breaker open
Add a single `console.warn` with `await navigator.storage.estimate()` + breaker status the first time the IDB circuit breaker opens per session. No UI change — just helps confirm whether affected devices are quota-bound.

## Files

- `src/pages/InspectionForm.tsx` — flush-before-load + merge on each `setInspection(data)` in `loadInspection`
- `src/pages/TrainingForm.tsx` — same
- `src/pages/DailyAssessmentForm.tsx` — same
- `src/components/PhotoGallery.tsx` — preserve-last-known + union pending
- `src/lib/idb-layer-breaker.ts` (or wherever the breaker lives) — one-shot estimate log on open

## Not changing

- `useFormRecordRealtime` guards (already correct)
- `applyTrackedFieldWrite` / `mergeRecordFields` / debounce window / RLS / schema
- Circuit-breaker thresholds

## Verification

- Type into Onsite Contact, immediately tap "Reload" toast → value persists.
- Reload tab while typing → value persists.
- Add a photo, navigate away during upload → photo still in gallery on return.
- All existing field-merge / sync-boundary tests pass; add a regression test "loadInspection flushes pending save before reading IDB."
