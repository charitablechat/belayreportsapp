

# Restyle "Save Before Leave" Dialog to Brutalist Glassmorphism Spec

## Current State
The `SaveBeforeLeaveDialog` and `UnsavedChangesDialog` components already exist and are wired into all three report forms. The back button, swipe-right, and browser back/forward navigation all trigger confirmation prompts. **No new wiring is needed.**

This plan updates the visual presentation and copy to match the requested spec.

## Changes

### 1. Update `SaveBeforeLeaveDialog.tsx` (Restyle + New Copy)
- **Title**: Change from "Save before leaving?" to "Unsaved Changes Detected"
- **Body**: Update to "You have unsaved progress in this report. Do you want to Save and Exit or Discard Changes and Exit?"
- **Save button**: Apply Emerald 400 styling (`bg-emerald-500 hover:bg-emerald-400 text-white`) for high visibility
- **Discard button**: Keep destructive red variant
- **Cancel button**: Keep outline variant
- **Container**: Add sharp `border border-white/20`, `backdrop-blur-xl`, `bg-slate-900/95`, and `shadow-2xl` for the frosted Brutalist look
- **Icon**: Add `AlertTriangle` icon in the title for visual emphasis

### 2. Update `UnsavedChangesDialog.tsx` (Matching Restyle)
Apply the same Brutalist Glassmorphism treatment so both dialogs (back-button triggered and browser-navigation triggered) look consistent:
- Same frosted glass container styling
- Emerald 400 for the "Save and Leave" button
- Matching typography and border treatment

### What Does NOT Change
- No form logic changes
- No save/persistence logic changes
- No navigation wiring changes
- No changes to `useBlocker` or `useUnsavedChanges` hooks

## Files Modified
| File | Change |
|------|--------|
| `src/components/SaveBeforeLeaveDialog.tsx` | Restyle + update copy |
| `src/components/UnsavedChangesDialog.tsx` | Matching restyle for consistency |

