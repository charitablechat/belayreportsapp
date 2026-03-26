

## Why the HARD-SAVED toast doesn't appear on Android

### Root Cause

The black-and-green "HARD-SAVED" toast only fires **after** all IndexedDB writes complete successfully (`Promise.all(childOps)`). On your Android device, IndexedDB is timing out (the console shows `[Offline Storage] Operation timed out after 8000ms` repeatedly). When that timeout throws an exception, execution jumps to the `catch` block — **skipping the toast entirely**.

Your data IS being saved — the localStorage snapshot (Layer 1) runs synchronously before the IndexedDB writes and always succeeds. But you get no visual feedback because the toast is gated on the IndexedDB step.

### Fix

Move the HARD-SAVED toast to fire immediately after the **localStorage snapshot** succeeds (which is synchronous and reliable), rather than waiting for IndexedDB. If IndexedDB subsequently fails, show a subtle warning but keep the green confirmation.

### Changes

**File: `src/pages/InspectionForm.tsx`**
- Move `showHardSavedToast()` call from after `Promise.all(childSaveOps)` (line 1468) to after `saveReportSnapshot()` (line 1458)
- In the IndexedDB catch block, show a non-alarming warning ("Saved to backup — retrying storage") instead of the current "Save failed" error

**File: `src/pages/TrainingForm.tsx`**
- Same pattern: move `showHardSavedToast()` from line 703 to after `saveReportSnapshot()` (line 693)
- Soften the IndexedDB catch message

**File: `src/pages/DailyAssessmentForm.tsx`**
- Same pattern: move `showHardSavedToast()` from line 753 to after `saveReportSnapshot()` (line 744)
- Soften the IndexedDB catch message

### Result
- Users see "HARD-SAVED" immediately on every manual save (localStorage is instant and never fails)
- If IndexedDB also succeeds — great, no additional feedback needed
- If IndexedDB times out — a non-alarming warning appears ("Saved to backup — will retry"), so the user knows data is safe but storage is slow

