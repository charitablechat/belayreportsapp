

# Fix Real Bugs in Inspection Report

After thorough code review, only 2 of the 6 reported issues are actual bugs. The other 4 are either already fixed or working correctly. Here is the assessment and fix plan:

## Assessment of All 6 Reported Bugs

| # | Bug | Status | Notes |
|---|-----|--------|-------|
| 1 | Form validation for New Inspections | **REAL BUG** | No validation on Organization/Location before submit |
| 2 | Broken Equipment Tab Navigation | **Not a bug** | Radix Tabs with `value`/`onValueChange` works correctly |
| 3 | Facility Name Combobox State Retention | **Already fixed** | `PopoverAnchor` + `setIsEditing(false)` already applied |
| 4 | Location Field Keyboard Input | **Not a bug** | Standard `<Input>` with `onChange` handler works correctly |
| 5 | Unsaved Changes Warning on Completed | **REAL BUG** | No status check -- warning fires on completed reports |
| 6 | PDF Download button inert | **By design** | PDF button intentionally commented out; HTML Download button in report viewer works correctly |

---

## Fix 1: Add Validation to New Inspection Form

**File:** `src/pages/NewInspection.tsx`

Add validation at the top of `handleSubmit` (before the `isSubmitting` guard) to check that `organization` and `location` are non-empty. Display a toast error and return early if either is blank.

Also add visual "required" indicators (asterisks) to the Organization and Location labels.

**Changes:**
- Add validation check inside `handleSubmit`:
  ```typescript
  if (!formData.organization.trim() || !formData.location.trim()) {
    toast.error("Required fields missing", {
      description: "Organization and Location are required."
    });
    return;
  }
  ```
- Add asterisks to the Organization and Location `<Label>` elements

---

## Fix 2: Suppress Unsaved Changes Warning on Completed Reports

**File:** `src/pages/InspectionForm.tsx`

The `useUnsavedChanges` hook at line 157 receives `hasUnsavedChanges` with no status check. When a completed report triggers internal updates (e.g., summary auto-regeneration), the warning dialog appears incorrectly.

**Change:** Pass `hasUnsavedChanges && inspection?.status !== 'completed'` to the hook:

```typescript
const { isBlocked, confirmNavigation, cancelNavigation } = useUnsavedChanges({
  hasUnsavedChanges: hasUnsavedChanges && inspection?.status !== 'completed',
  message: "You have unsaved changes to this inspection. Are you sure you want to leave?",
});
```

This ensures the warning only appears for draft reports with pending modifications.

---

## Files Changed

| File | Change |
|------|--------|
| `src/pages/NewInspection.tsx` | Add required field validation + visual indicators |
| `src/pages/InspectionForm.tsx` | Suppress unsaved changes warning for completed reports |

## What This Does NOT Change

- No changes to tab navigation (already working)
- No changes to OrganizationAutocomplete (already fixed)
- No changes to Location input (already working)
- No changes to PDF/HTML download (HTML download works; PDF is intentionally hidden)
- No changes to auto-save, auth, or report generation logic

