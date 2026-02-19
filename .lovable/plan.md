

# Batch Selection for Deleted Records

Add checkbox-based multi-select to the Deleted Records Recovery table, enabling batch permanent deletion of selected records.

## Changes

### File: `src/hooks/useSoftDelete.tsx`

Add a `batchPermanentDelete` function that loops through an array of `{ table, recordId }` entries, calling `permanentDelete` for each. Returns a summary of successes and failures.

### File: `src/components/admin/DeletedRecordsRecovery.tsx`

**State additions:**
- `selectedIds: Set<string>` -- tracks selected record IDs (using `table_name-record_id` composite keys)

**UI additions:**
1. A new checkbox column as the first column in the table header and each row
2. A "Select All" checkbox in the header that toggles all visible records in the current tab
3. A floating action bar (or inline toolbar) that appears when 1+ records are selected, showing:
   - Count of selected records (e.g., "3 selected")
   - "Delete Selected" button (destructive) that opens a confirmation dialog
   - "Clear Selection" button
4. A new `batch-delete` confirmation dialog type

**Selection logic:**
- "Select All" only selects records visible in the active tab (All, Inspections, Trainings, or Assessments)
- Switching tabs preserves selection across tabs (composite keys ensure uniqueness)
- After batch delete completes, clear selection and reload records

**Batch delete handler:**
- Maps selected IDs back to `{ table_name, record_id }` pairs from the `deletedRecords` array
- Calls `permanentDelete` for each selected record
- Shows a toast with the result count (e.g., "Permanently deleted 5 records")
- Clears selection and refreshes the list

## Technical Details

### State shape
```typescript
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

const makeKey = (r: DeletedRecord) => `${r.table_name}-${r.record_id}`;
```

### Select All logic (scoped to current tab)
```typescript
const toggleSelectAll = (records: DeletedRecord[]) => {
  const keys = records.map(makeKey);
  const allSelected = keys.every(k => selectedIds.has(k));
  setSelectedIds(prev => {
    const next = new Set(prev);
    if (allSelected) {
      keys.forEach(k => next.delete(k));
    } else {
      keys.forEach(k => next.add(k));
    }
    return next;
  });
};
```

### Batch delete confirmation dialog
A new `confirmDialog` type value `'batch-delete'` triggers a dialog showing how many records will be permanently deleted, with the standard destructive styling and "cannot be undone" warning.

## What This Does NOT Change

- No modifications to soft-delete logic, retention periods, or RLS policies
- The existing single-record restore and delete flows remain unchanged
- No changes to the `permanentDelete` function itself -- batch just calls it in a loop
- All existing data safety protocols (60-day retention, super-admin-only access) stay intact

