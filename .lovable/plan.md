

# Always-Prompt "Save Before Leaving" on Back Button

## Current Behavior
The back button in each report form (`InspectionForm`, `TrainingForm`, `DailyAssessmentForm`) calls `goBack(navigate)` directly. A confirmation dialog only appears if `hasUnsavedChanges` is `true` (via `useBlocker`). If the user has no pending edits (or they were just auto-saved), pressing back silently exits.

## New Behavior
Every time the back button is pressed inside a report, a confirmation dialog appears with three options:
- **Save and Leave** -- saves the report, then navigates back
- **Leave Without Saving** -- navigates back immediately
- **Stay on Page** -- closes the dialog, no action

This is independent of the existing `useBlocker`-based unsaved changes protection, which continues to guard against browser back/forward and link navigation.

## Implementation

### 1. New Component: `SaveBeforeLeaveDialog.tsx`
A lightweight dialog styled with the existing Glassmorphism aesthetic (reuses the `AlertDialog` primitives already in the project). Three buttons: "Stay on Page", "Save and Leave", "Leave Without Saving".

### 2. Modify `InspectionForm.tsx`
- Add `showLeaveDialog` state (boolean, default `false`).
- Change the back button `onClick` from `safeGoBack()` to `setShowLeaveDialog(true)`.
- Change the swipe-right-on-first-tab handler from `goBack(navigate)` to `setShowLeaveDialog(true)`.
- Render `SaveBeforeLeaveDialog` with:
  - `onSave`: calls the existing save function, then `goBack(navigate)`.
  - `onLeave`: calls `goBack(navigate)` directly.
  - `onCancel`: closes the dialog.

### 3. Modify `TrainingForm.tsx`
Same pattern: intercept back button and first-tab swipe-right with the dialog.

### 4. Modify `DailyAssessmentForm.tsx`
Same pattern: intercept back button and first-tab swipe-right with the dialog.

## What Does NOT Change
- The existing `useBlocker` / `UnsavedChangesDialog` system remains intact for guarding against browser navigation, link clicks, and programmatic route changes.
- No business logic, save logic, offline storage, or auth flows are modified.
- Emergency save behavior is unaffected.

## Files
| File | Action |
|------|--------|
| `src/components/SaveBeforeLeaveDialog.tsx` | **Create** -- new dialog component |
| `src/pages/InspectionForm.tsx` | **Edit** -- wire back button and swipe to dialog |
| `src/pages/TrainingForm.tsx` | **Edit** -- wire back button and swipe to dialog |
| `src/pages/DailyAssessmentForm.tsx` | **Edit** -- wire back button and swipe to dialog |

