

# Fix: Allow Photo Editing in Completed Reports via Lock Dialog

## Problem

When a report is completed, clicking on photos does NOT trigger the "REPORT LOCKED" dialog because the `onClickCapture` interceptor only matches form elements (`input`, `textarea`, `select`, etc.) and buttons. Photo elements (`img`, drag handles, card containers) are not in the selector list, so users have no way to unlock the report by interacting with the photo gallery.

Once unlocked (via clicking a text field first), photos become fully editable -- the underlying logic is correct, but the entry point is missing for photo-specific interactions.

## Fix

Update the `handleLockedFieldClick` CSS selector in all three form files to also match photo gallery elements. This ensures clicking anywhere on a photo card triggers the lock dialog.

### Files to Change

**1. `src/pages/InspectionForm.tsx` (line 137-138)**

Add `img, .photo-item, [data-draggable-photo]` to the selector string:

```
'input, textarea, select, [role="checkbox"], [role="combobox"], ' +
'[contenteditable], .tiptap, button:not([data-nav]):not([role="tab"]), img, .photo-item, [data-draggable-photo]'
```

**2. `src/pages/TrainingForm.tsx` (line 100-101)**

Same addition:

```
'input, textarea, select, [role="checkbox"], [role="combobox"], ' +
'[contenteditable], .tiptap, button:not([data-nav]), img, .photo-item, [data-draggable-photo]'
```

**3. `src/pages/DailyAssessmentForm.tsx` (line 103-104)**

Same addition (match the existing selector pattern for this form).

### What This Changes

- Clicking on any photo image, photo card, or draggable photo wrapper in a locked report will now trigger the "REPORT LOCKED" amber dialog
- After the user confirms "Unlock and Edit", `completionLockOverridden` becomes `true`, which sets `effectiveReadOnly` to `false`, enabling both text editing and photo drag-and-drop
- No changes to PhotoGallery, PhotoCapture, or any backend logic

### What Does NOT Change

- The unlock flow itself (dialog, state toggle, permission checks)
- Photo drag-and-drop mechanics (DndContext, sensors, order persistence)
- Auto-save, backup, or sync behavior
- Read-only enforcement for non-owners
- Any backend or edge function code
