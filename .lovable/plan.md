

## Bug: "Save & Exit" Dialog Gets Stuck in "Saving..." State

### Root Cause

In `InspectionForm.tsx` (and identically in `TrainingForm.tsx` and `DailyAssessmentForm.tsx`), the `onSave` handler in `SaveBeforeLeaveDialog` sets `isSavingBeforeLeave(true)` but **never resets it to `false`**. There are two failure modes:

1. **Navigation blocked**: After the save completes, `goBack(navigate)` fires inside `setTimeout(0)`. If the `useBlocker` guard re-intercepts (race between `setHasUnsavedChanges(false)` and the blocker evaluating), the dialog stays visible with all three buttons disabled.

2. **Mutex skip**: If an auto-save is already in progress (`anySaveInProgressRef.current === true`), `performSave` returns immediately without doing any work. The dialog shows "Saving..." but the data was never actually saved. Then navigation proceeds, potentially losing the unsaved delta.

3. **No timeout**: Unlike other save paths that have 5-8 second safety timeouts, this path has no upper bound. If `performSave` hangs (e.g., waiting on an IndexedDB transaction that never resolves), the UI is permanently stuck.

### Fix

Add three safeguards to the `onSave` handler in all three form files:

**1. Always reset `isSavingBeforeLeave` in a `finally` block**

Wrap the entire `onSave` handler in try/finally so that `setIsSavingBeforeLeave(false)` always executes, regardless of success or failure. This ensures the buttons are never permanently disabled.

**2. Add a safety timeout (8 seconds)**

Wrap the `handleSaveAndLeave()` call in a `Promise.race` with an 8-second timeout. If the save hangs, the timeout resolves, the state resets, and the user regains control of the dialog.

**3. Wait for mutex if save is in progress**

Before calling `performSave`, if the mutex is held, wait up to 3 seconds for it to release (poll every 200ms). This handles the case where auto-save is mid-flight -- instead of skipping, we wait for it to finish, ensuring the latest data is persisted before navigating.

### Code Change (same pattern in all 3 files)

```typescript
onSave={async () => {
  if (isSavingBeforeLeave) return;
  setIsSavingBeforeLeave(true);
  leavingRef.current = true;
  try {
    // Race against an 8-second safety timeout
    await Promise.race([
      handleSaveAndLeave(),
      new Promise(resolve => setTimeout(resolve, 8000)),
    ]);
    setShowLeaveDialog(false);
    setHasUnsavedChanges(false);
    emitSyncComplete();
    markPendingDashboardRefresh();
    setTimeout(() => goBack(navigate), 0);
  } catch (e) {
    console.warn('[Form] Save-before-leave error:', e);
    // Still navigate -- the emergency save / localStorage snapshot
    // will preserve data
    setShowLeaveDialog(false);
    setHasUnsavedChanges(false);
    setTimeout(() => goBack(navigate), 0);
  } finally {
    setIsSavingBeforeLeave(false);
  }
}}
```

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Wrap `onSave` handler in try/finally with timeout |
| `src/pages/TrainingForm.tsx` | Same pattern |
| `src/pages/DailyAssessmentForm.tsx` | Same pattern |

### What This Does NOT Change

- No changes to the save logic itself (`performSave`, `handleSaveAndLeave`)
- No changes to IndexedDB, sync, or localStorage
- No changes to the `useBlocker` or `useUnsavedChanges` hook
- The emergency save system remains the safety net if the timed-out save didn't complete

