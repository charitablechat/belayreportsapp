

## Fix: Save & Exit Navigation Loop on Locked Reports

### Root Cause

The report forms (Inspection, Training, Daily Assessment) have **two separate navigation guard systems** that can fight each other:

1. **SaveBeforeLeaveDialog** -- shown when the user clicks the Back button. Its "Save & Exit" handler saves, then calls `setTimeout(() => goBack(navigate), 0)`.
2. **UnsavedChangesDialog** (via `useBlocker`) -- blocks any SPA navigation when `hasUnsavedChanges` is true.

The loop occurs because:

1. User clicks Back button, SaveBeforeLeaveDialog opens.
2. User clicks "Save & Exit". The handler runs `handleSaveAndLeave()`, sets `hasUnsavedChanges(false)`, then queues `setTimeout(() => goBack(navigate), 0)`.
3. `goBack` fires `navigate(-1)`. But React may not have flushed the `hasUnsavedChanges = false` state into `useBlocker`'s registered condition yet (effects run after paint; setTimeout(0) timing vs useEffect registration is not guaranteed).
4. `useBlocker` blocks the navigation. The URL briefly shows `/dashboard`, then reverts. The user sees the report again with `UnsavedChangesDialog` now showing.
5. User clicks "Save & Exit" in UnsavedChangesDialog. `blocker.proceed()` completes the navigation to Dashboard.
6. But `trackNavigation()` in RootLayout incremented `navigationDepth` when the URL briefly changed. And the save may have re-triggered `hasUnsavedChanges(true)` via state effects before the user could escape.

**Secondary issue**: The `isSaving` prop on SaveBeforeLeaveDialog is bound to the `saving` state, but `handleSaveAndLeave` calls `performSave()` directly without setting `saving = true`. This means the Save & Exit button is NOT disabled during the save operation, allowing double-clicks that queue multiple `goBack` calls.

### Solution

**Approach**: When the SaveBeforeLeaveDialog handles exit, temporarily disable the `useBlocker` guard so the two systems don't conflict, and properly track the saving state.

### Technical Changes

#### File 1: `src/pages/InspectionForm.tsx`

1. **Add a `leavingRef` flag** that is set to `true` when SaveBeforeLeaveDialog's Save & Exit or Discard is clicked. This ref prevents the `useBlocker` condition from being true during the programmatic navigation.

2. **Update the useBlocker condition** to include the leaving flag:
   ```
   // Before:
   hasUnsavedChanges: hasUnsavedChanges && (inspection?.status !== 'completed' || completionLockOverridden)
   
   // After:
   hasUnsavedChanges: hasUnsavedChanges && (inspection?.status !== 'completed' || completionLockOverridden) && !leavingRef.current
   ```

3. **Track saving state in SaveBeforeLeaveDialog's onSave**: Add a local `isSavingBeforeLeave` state that is set to true when Save & Exit is clicked, preventing double-clicks.

4. **Update onSave handler**:
   ```typescript
   onSave={async () => {
     if (isSavingBeforeLeave) return; // prevent double-click
     setIsSavingBeforeLeave(true);
     leavingRef.current = true;       // disable useBlocker
     await handleSaveAndLeave();
     setShowLeaveDialog(false);
     setHasUnsavedChanges(false);
     emitSyncComplete();
     markPendingDashboardRefresh();
     setTimeout(() => goBack(navigate), 0);
   }}
   ```

5. **Update onLeave handler** similarly:
   ```typescript
   onLeave={() => {
     leavingRef.current = true;       // disable useBlocker
     setShowLeaveDialog(false);
     setHasUnsavedChanges(false);
     setTimeout(() => goBack(navigate), 0);
   }}
   ```

6. **Pass `isSavingBeforeLeave`** to the dialog's `isSaving` prop instead of the unrelated `saving` state.

#### File 2: `src/pages/TrainingForm.tsx`

Apply the same three changes:
- Add `leavingRef` and `isSavingBeforeLeave` state
- Update `useUnsavedChanges` condition to include `!leavingRef.current`
- Guard `onSave` and `onLeave` handlers with `leavingRef.current = true` and double-click prevention

#### File 3: `src/pages/DailyAssessmentForm.tsx`

Apply the same three changes as above.

### Why This Works

- Setting `leavingRef.current = true` immediately (synchronously, before any async work) ensures that `useBlocker` sees a `false` condition on the very next render, regardless of React batching timing.
- Using a ref (not state) means the value is available immediately without waiting for a re-render.
- The double-click guard prevents multiple `goBack` calls from being queued.
- The existing `UnsavedChangesDialog` (useBlocker path) continues to work independently for browser back/forward button presses and programmatic navigations that don't go through SaveBeforeLeaveDialog.

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Add leavingRef, isSavingBeforeLeave, update useBlocker condition, guard onSave/onLeave |
| `src/pages/TrainingForm.tsx` | Same pattern |
| `src/pages/DailyAssessmentForm.tsx` | Same pattern |

### What Stays Unchanged

- No changes to navigation logic, sync pipeline, or data storage
- No changes to the useBlocker/UnsavedChangesDialog system itself
- No changes to SaveBeforeLeaveDialog component
- All existing data protections remain intact

