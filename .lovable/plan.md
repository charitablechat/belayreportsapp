

# Completion Lock for Finalized Reports

## Overview

Add a confirmation gate that prevents accidental edits to completed reports. When a report's status is `completed`, the form renders in a locked (read-only) state. If the user attempts to edit, a confirmation dialog appears. Selecting "Yes" unlocks the form for the session; selecting "No" keeps it locked.

## Logic Flow

```text
User opens report
       |
       v
  Status === 'completed'?
    NO  --> Form loads in normal edit mode (no change from today)
    YES --> Form loads in READ-ONLY mode (locked)
              |
              v
        User attempts edit (clicks field, Save, Complete, etc.)
              |
              v
        Confirmation dialog appears:
        "This report has been completed. Do you want to proceed with new edits?"
              |
         +----+----+
         |         |
        YES       NO / Cancel
         |         |
         v         v
    Set session   Dismiss dialog,
    unlock flag   form stays locked
    (state var)
         |
         v
    Form re-renders
    in full edit mode
    for this session
```

## What Changes

### 1. New state variable in each form (InspectionForm, TrainingForm, DailyAssessmentForm)

- `completionLockOverridden` -- a boolean, starts `false`
- `showCompletionLockDialog` -- a boolean controlling dialog visibility

### 2. Derive the effective read-only state

Currently each form uses:
```
const { canEdit, isReadOnly } = useReportEditPermission(...)
```

A new derived value will combine the existing permission check with the completion lock:

```
const isCompletionLocked = report?.status === 'completed' && !completionLockOverridden;
const effectiveReadOnly = isReadOnly || isCompletionLocked;
```

All existing `isReadOnly` references in each form's JSX will be replaced with `effectiveReadOnly`. This is a find-and-replace within each form file -- no child component changes needed since they already accept a generic `isReadOnly` prop.

### 3. Intercept edit attempts

When `isCompletionLocked` is true and the user clicks an interactive element (a field, Save button, etc.), the form opens the confirmation dialog instead of performing the action. The simplest approach: wrap the form content area in a transparent overlay `div` that captures clicks and opens the dialog, only rendered when `isCompletionLocked` is true. This avoids modifying every individual input component.

### 4. Confirmation dialog

A shared reusable component (or inline AlertDialog) with:
- **Title**: "Report Locked"
- **Message**: "This report has been completed. Do you want to proceed with new edits?"
- **Actions**: "Yes, Edit" (sets `completionLockOverridden = true`, closes dialog) and "No" (closes dialog, no state change)

This will use the existing `AlertDialog` component already imported in the codebase.

### 5. Lock resets

The `completionLockOverridden` flag is session-scoped (React state). It resets naturally when the user navigates away and returns. No persistence needed.

## Files Modified

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Add `completionLockOverridden` state, derive `effectiveReadOnly`, add dialog, replace `isReadOnly` references |
| `src/pages/TrainingForm.tsx` | Same pattern |
| `src/pages/DailyAssessmentForm.tsx` | Same pattern |

Optionally, the dialog can be extracted into a shared component (e.g., `src/components/CompletionLockDialog.tsx`) to avoid duplication across the three forms.

## What Does NOT Change

- **No database changes** -- status field and values remain identical
- **No changes to `useReportEditPermission`** -- the hook continues to handle ownership and super-admin logic independently
- **No changes to save/sync logic** -- debounce timers, auto-save, `useBlocker`, and atomic sync are untouched
- **No changes to child components** -- they already respect the `isReadOnly` / `readOnly` prop passed down
- **No changes to the completion flow** -- marking a report as completed works exactly as before
- **No RLS or backend changes**

## Edge Cases

- **Super Admin viewing another user's completed report**: Both `isReadOnly` (from permissions) and `isCompletionLocked` would be true. The permission-based lock takes priority -- the completion lock dialog would not appear since the form is already read-only for a different reason.
- **Owner re-opens a completed report, unlocks, makes edits, then navigates away**: The existing `useBlocker` / `UnsavedChangesDialog` handles unsaved changes as normal. On return, the lock re-engages.
- **Report completed during the current session**: After the completion action succeeds, `isCompletionLocked` becomes true. The user would need to confirm to make further edits, which is the intended behavior.

