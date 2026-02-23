

## Fix: Save & Exit Loop on Locked Reports

### Root Cause

Two competing navigation guard systems are conflicting:

1. **SaveBeforeLeaveDialog** -- shown when user clicks the back button; provides "Save & Exit", "Exit Without Saving", and "Stay on Page" options
2. **useBlocker / UnsavedChangesDialog** -- React Router's built-in navigation blocker that intercepts any `navigate()` call when `hasUnsavedChanges` is true

When the user clicks "Save & Exit" in the `SaveBeforeLeaveDialog`, the handler does:
```
setHasUnsavedChanges(false)   // queues state update (not applied yet)
goBack(navigate)              // calls navigate(-1) immediately
```

Because React batches state updates, `hasUnsavedChanges` is still `true` when `navigate(-1)` fires. The `useBlocker` hook intercepts this navigation, creating a conflict between the two dialog systems. This results in the user briefly seeing the dashboard before being bounced back to the report.

### Fix

Wrap the `goBack(navigate)` call in a `setTimeout(0)` to defer navigation until after React has processed the state update (`setHasUnsavedChanges(false)`). This ensures `useBlocker` sees `false` and allows the navigation through without interference.

This same fix applies to the "Exit Without Saving" (`onLeave`) handler as well, since it has the same race condition.

### Files Changed

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Defer `goBack(navigate)` in both `onSave` and `onLeave` handlers using `setTimeout` |
| `src/pages/TrainingForm.tsx` | Same fix |
| `src/pages/DailyAssessmentForm.tsx` | Same fix |

### Technical Detail

In each form's `SaveBeforeLeaveDialog`:

```typescript
onSave={async () => {
  await handleSaveAndLeave();
  setShowLeaveDialog(false);
  setHasUnsavedChanges(false);
  emitSyncComplete();
  // Defer navigation to next tick so React processes
  // setHasUnsavedChanges(false) before useBlocker evaluates
  setTimeout(() => goBack(navigate), 0);
}}
onLeave={() => {
  setShowLeaveDialog(false);
  setHasUnsavedChanges(false);
  setTimeout(() => goBack(navigate), 0);
}}
```

### What is NOT Changing

- No backend or database changes
- No changes to the lock/unlock dialog or completion lock logic
- No changes to Dashboard.tsx or the sync system
- The `useBlocker` / `UnsavedChangesDialog` system remains intact as a safety net
- The `emitSyncComplete()` dashboard refresh fix remains in place

