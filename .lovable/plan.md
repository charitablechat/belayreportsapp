

# Simplify Data Recovery Sheet

## Problem
The Data Recovery sheet shows two panels:
1. **Local Backup Snapshots** -- the localStorage-based backup viewer (this is the useful one)
2. **Local Data Recovery Tool** -- the IndexedDB viewer with count cards (redundant for regular users)

The IndexedDB panel is admin-level functionality that clutters the user-facing recovery sheet.

## Change

**File: `src/components/UserDataRecoverySheet.tsx`**

Remove the `IndexedDBRecoveryPanel` and its error boundary wrapper, keeping only the `LocalSnapshotsPanel`. This means:
- Remove the import of `IndexedDBRecoveryPanel`
- Remove the second `RecoveryErrorBoundary` block wrapping `IndexedDBRecoveryPanel`

The result will be a clean sheet with just the "Local Backup Snapshots" section where users can view and restore their localStorage backups.

## Technical Details

- The `IndexedDBRecoveryPanel` component remains exported from `DataRecoveryTool.tsx` for use in the Super Admin dashboard -- it is only removed from the **user-facing** sheet
- No other files reference `UserDataRecoverySheet` differently, so no cascading changes needed

