

# Clear Stale Queued Operations -- with Batch Select and Delete

## Overview
Enhance the "Queued Ops" tab in the Super Admin Data Recovery Tool so admins can inspect operation age, delete individual operations, select multiple operations via checkboxes, and batch-delete the selection. Also add a "Clear All" master button with confirmation.

## What Changes

### 1. New bulk-clear functions in `src/lib/offline-storage.ts`
Add three new exported functions that wipe all entries from each operations store:
- `clearAllQueuedOperations()` -- clears the `operations` IndexedDB store
- `clearAllQueuedAssessmentOperations()` -- clears `assessment_operations`
- `clearAllQueuedTrainingOperations()` -- clears `training_operations`

These use the existing `getDB()` helper and call `.clear()` on the store inside a transaction.

### 2. Enhanced "Queued Ops" tab in `src/components/admin/DataRecoveryTool.tsx`

#### a) Age indicator column
Each row gets a color-coded "Age" badge:
- Green: queued less than 1 hour ago
- Amber: 1--24 hours
- Red: more than 24 hours

#### b) Per-row delete button
A trash icon on each row that calls the existing `removeQueuedOperation` / `removeQueuedAssessmentOperation` / `removeQueuedTrainingOperation` (keyed by the operation's auto-increment `id`).

#### c) Checkbox selection for batch delete
- A checkbox in each table header row to "select all" within that section
- A checkbox on each operation row to toggle selection
- State tracked as `Set<string>` using a composite key like `"inspection-3"` or `"assessment-12"`

#### d) "Delete Selected" button
Appears in each section header when 1+ items are selected. Triggers an AlertDialog confirmation, then deletes all selected operations and refreshes.

#### e) Master "Clear All Queued Operations" button
At the top of the Queued Ops card, a destructive button that opens an AlertDialog and clears all three stores at once, then refreshes.

#### f) Per-section "Clear All" button
Next to each section heading (e.g., "Inspection Operations (5)"), a small "Clear All" button to flush just that section's store.

### Files Modified

| File | Change |
|------|--------|
| `src/lib/offline-storage.ts` | Add 3 bulk-clear functions |
| `src/components/admin/DataRecoveryTool.tsx` | Add imports for new clear functions + existing remove functions, add selection state, checkboxes, age badges, delete/batch-delete buttons, and confirmation dialogs |

### Technical Notes

- The queued operations use auto-increment keys (`key: number`), so each operation has an `id` field. The existing `removeQueuedOperation(id)` already accepts this numeric key.
- Selection state is local React state (`useState<Set<string>>`), reset after any delete action.
- After any delete/clear, `loadLocalData()` is called to refresh all counts and tables.
- No database or RLS changes needed -- this is purely local IndexedDB management.

