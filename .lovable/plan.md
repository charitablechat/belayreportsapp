## What you're seeing

Those stacked "Remote update available — Keep my changes / Reload" cards in the screenshot are **Sonner toasts**, not a sidebar. They fire from three places:

- `src/pages/InspectionForm.tsx` (~line 664)
- `src/pages/TrainingForm.tsx` (~line 708)
- `src/pages/DailyAssessmentForm.tsx` (~line 462)

Each form subscribes to `onPendingRemoteUpdate`. When Realtime fires an `UPDATE` for the open report and `hasUnsavedRef.current === true`, the form pops this toast. Because the same device's own writes (and other open tabs) emit Realtime updates, users see this toast pop repeatedly while editing — and they stack because Sonner doesn't dedupe them.

## Why it's safe to remove

The original purpose of the toast was "your unsaved edits will be lost if we refetch." That's no longer true:

- `loadInspection` / `loadTraining` / `loadAssessment` now flush pending debounced saves before reading IDB (Fix #1 from the prior turn).
- Server data is merged per-field via `mergeRecordFields(prev, server, TRACKED_FIELDS.*)` (Fix #2). Locally-newer fields survive a refetch.
- `useFormRecordRealtime` already early-returns on `hasUnsavedRef`, and `isRecentSelfWrite` already suppresses self-write echoes.

So the user-facing prompt is redundant — the system can just silently reconcile.

## Plan

1. **Remove the toast in all three forms.** In the `onPendingRemoteUpdate` handler in `InspectionForm.tsx`, `TrainingForm.tsx`, and `DailyAssessmentForm.tsx`:
   - Keep the `isRecentSelfWrite` early return.
   - Remove the `hasUnsavedRef.current` branch that calls `toast.warning(...)`.
   - Always call `loadInspection() / loadTraining() / loadAssessment()` — the per-field merge will preserve unsaved local edits.
   - Add a `console.log` in DEV explaining the silent reconcile path.

2. **Leave everything else alone.**
   - No changes to `useFormRecordRealtime`, `atomic-sync-manager`, `mergeRecordFields`, debounce, RLS, or schema.
   - No changes to actual sidebars (`src/components/ui/sidebar.tsx` is unrelated and untouched).
   - No changes to data persistence — merge logic already handles concurrent edits.

3. **Verification.**
   - Open the same report on two devices, edit on one, save → no toast on the other; values merge silently.
   - Edit Onsite Contact, switch tabs, come back → no toast, value persists.
   - Existing field-merge / refetch-race / self-write-suppression tests still pass.

## Files

- `src/pages/InspectionForm.tsx`
- `src/pages/TrainingForm.tsx`
- `src/pages/DailyAssessmentForm.tsx`
