

# Fix Back Arrow Navigation in Inspection Form

## Problem

The back arrow button calls `goBack(navigate)` directly, which bypasses the `useUnsavedChanges` protection. This causes two issues:

1. The `beforeunload` browser event may silently interfere with navigation on mobile browsers when there are unsaved changes
2. The unsaved changes confirmation dialog never appears -- the user either gets stuck or loses data

## Fix

### `src/pages/InspectionForm.tsx` (single file)

**Change the back button's onClick** from:
```
onClick={() => goBack(navigate)}
```
to:
```
onClick={() => safeGoBack()}
```

**Add a `safeGoBack` helper** that integrates with `useUnsavedChanges`:
- Extract `safeNavigate` from the existing `useUnsavedChanges` hook (it's already returned but unused)
- Create a `safeGoBack` function that determines the correct destination (using the same logic as `goBack` -- check history length, fall back to `/dashboard`) and passes it through `safeNavigate`
- This ensures the "Unsaved Changes" dialog appears when needed, and navigation proceeds cleanly when there are no changes

**Also update the swipe-right handler** (line 152) which has the same bypass issue -- it calls `goBack(navigate)` directly when on the first tab.

### What changes in behavior

- If the user has **no unsaved changes**: back arrow works exactly as before (immediate navigation)
- If the user has **unsaved changes**: the "Unsaved Changes" dialog appears, letting them choose to stay or leave
- The swipe-to-go-back gesture on the first tab gets the same protection

### No other files change

The `goBack` utility, `useUnsavedChanges` hook, and `UnsavedChangesDialog` all remain as-is.

