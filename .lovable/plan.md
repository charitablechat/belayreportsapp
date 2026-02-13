

# Fix: Equipment Data Loss on Completed Report Edits

## Root Cause

**Line 187 in `InspectionForm.tsx`** disables the unsaved-changes navigation guard for all completed reports:

```typescript
hasUnsavedChanges: hasUnsavedChanges && inspection?.status !== 'completed',
```

When you unlock a completed report via the completion lock dialog and edit equipment fields (quantity, production year), the navigation blocker remains disabled because the status is still `'completed'`. If you navigate away before the 1.5-second auto-save debounce fires, the edits are silently discarded -- no warning dialog, no save-before-leave.

## Fix

Update line 187 to account for the `completionLockOverridden` state. When the lock has been overridden (meaning the user intentionally chose to edit), the navigation guard should be active:

```typescript
hasUnsavedChanges: hasUnsavedChanges && (inspection?.status !== 'completed' || completionLockOverridden),
```

This single-line change ensures:
- **Normal completed reports** (locked): No blocker needed since the form is read-only anyway
- **Unlocked completed reports** (user chose to edit): Full navigation protection, including the "Save and Leave" option that flushes pending auto-saves before navigating

## File Change

### `src/pages/InspectionForm.tsx` (line 187)

**Before:**
```typescript
hasUnsavedChanges: hasUnsavedChanges && inspection?.status !== 'completed',
```

**After:**
```typescript
hasUnsavedChanges: hasUnsavedChanges && (inspection?.status !== 'completed' || completionLockOverridden),
```

## Why This Is Safe

- The `completionLockOverridden` state is already defined (line 76) and is set to `true` only when the user explicitly confirms "Yes, I want to edit" in the completion lock dialog
- The existing `saveAndLeave` handler (line 168-183) already flushes debounced saves and calls `performSave` -- no additional save logic needed
- No changes to data loading, IndexedDB persistence, or server sync -- only the navigation guard condition

## Impact

| Scenario | Before | After |
|----------|--------|-------|
| Edit completed report, navigate away quickly | Data silently lost | "Unsaved changes" dialog appears with Save and Leave option |
| Edit completed report, wait for auto-save | Data saved (1.5s debounce) | Same behavior |
| View completed report without unlocking | No blocker (read-only) | Same behavior |

