

# Fix: Back Button Reliability Across All Report Forms

## Problem Identified

After investigating the code, the `goBack` utility and `navigationDepth` tracker in `src/lib/navigation.ts` and `src/App.tsx` are working correctly. The actual issue is an inconsistency in how **TrainingForm** and **DailyAssessmentForm** configure their unsaved-changes blocker compared to **InspectionForm**.

### Root Cause

| Form | `useBlocker` condition | `onSaveAndLeave` | Effect on completed reports |
|------|------------------------|-------------------|-----------------------------|
| InspectionForm | `hasUnsavedChanges && status !== 'completed'` | Yes | Blocker disabled when completed -- back works freely |
| TrainingForm | `hasUnsavedChanges` (no status check) | No | Blocker may fire on completed reports, blocking back navigation |
| DailyAssessmentForm | `hasUnsavedChanges` (no status check) | No | Same problem as TrainingForm |

When a completed report triggers `hasUnsavedChanges` (e.g., from initial data load or internal state updates), the `useBlocker` intercepts the back button navigation. This creates the appearance that the back button "doesn't work" -- the click is consumed by the blocker but the dialog may not be clearly visible or actionable.

## Fix (3 files)

### 1. `src/pages/TrainingForm.tsx`

**Line ~129-132**: Update `useUnsavedChanges` to exclude completed reports from the blocker, matching InspectionForm's pattern:

```typescript
// BEFORE
const { isBlocked, confirmNavigation, cancelNavigation } = useUnsavedChanges({
  hasUnsavedChanges,
  message: "...",
});

// AFTER
const { isBlocked, confirmNavigation, cancelNavigation, saveAndLeave } = useUnsavedChanges({
  hasUnsavedChanges: hasUnsavedChanges && training?.status !== 'completed',
  message: "You have unsaved changes to this training report. Are you sure you want to leave?",
  onSaveAndLeave: async () => { /* flush debounce + immediate save */ },
});
```

**Line ~944-948**: Pass `saveAndLeave` to `UnsavedChangesDialog`:

```typescript
<UnsavedChangesDialog
  isOpen={isBlocked}
  onConfirm={confirmNavigation}
  onCancel={cancelNavigation}
  onSaveAndLeave={saveAndLeave}  // ADD THIS
  message="..."
/>
```

Add a `saveBeforeLeaveRef` pattern (same as InspectionForm) to flush the auto-save debounce timer and perform an immediate save before navigation proceeds.

### 2. `src/pages/DailyAssessmentForm.tsx`

**Line ~123-127**: Same fix as TrainingForm:

```typescript
// BEFORE
const { isBlocked, confirmNavigation, cancelNavigation } = useUnsavedChanges({
  hasUnsavedChanges,
  message: "...",
});

// AFTER
const { isBlocked, confirmNavigation, cancelNavigation, saveAndLeave } = useUnsavedChanges({
  hasUnsavedChanges: hasUnsavedChanges && assessment?.status !== 'completed',
  message: "You have unsaved changes to this assessment. Are you sure you want to leave?",
  onSaveAndLeave: async () => { /* flush debounce + immediate save */ },
});
```

Pass `saveAndLeave` to `UnsavedChangesDialog` in the JSX as well.

### 3. Verify `src/pages/InspectionForm.tsx`

No changes needed -- this form already implements the correct pattern. It serves as the reference implementation.

## What This Fixes

- Back button on completed Training reports no longer gets blocked by `useBlocker`
- Back button on completed Daily Assessment reports no longer gets blocked
- All three forms gain a consistent "Save and Leave" option in the unsaved changes dialog
- Swipe-back gesture on first tab (mobile) also benefits from the same fix since it calls `goBack(navigate)`

## What Does NOT Change

- The `goBack` utility and `navigationDepth` tracker remain unchanged (they work correctly)
- No changes to `useUnsavedChanges` hook itself
- No changes to `CompletionLockDialog` or `CompletionLockOverlay`
- No changes to save/sync logic, auto-save debounce, or data persistence
- No database or backend changes

