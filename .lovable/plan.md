

# Add Search to All Snapshot Panels

## Current State
- **Local panel**: Has search, but only matches `organization`
- **Cloud panel**: Has search, matches `facility` and `user_name`
- **All Users panel**: Has search, matches `facility` and `user_name`
- **Admin Edit History**: No search at all
- **IndexedDB panel**: No search

## Changes

### 1. Enhance existing search filters (`DataRecoveryTool.tsx`)

**Local panel** — expand filter to also match `reportType`, `device`, and `reportId`:
```ts
const filteredSnapshots = snapshots.filter(s => {
  if (!searchQuery) return true;
  const q = searchQuery.toLowerCase();
  return (s.organization || '').toLowerCase().includes(q)
      || s.reportType.replace('_', ' ').toLowerCase().includes(q)
      || s.device.toLowerCase().includes(q)
      || s.reportId.toLowerCase().includes(q);
});
```

**Cloud and All Users panels** — add `report_type`, `device`, and `report_id` to existing filter.

### 2. Add search to Admin Edit History panel

- Add `searchQuery` state and `RecoverySearchBar` above the results list
- Filter by `report_type`, `owner_name`, `editor_name`, and `report_id`

### 3. Add search to IndexedDB panel

- Add `searchQuery` state and `RecoverySearchBar` 
- Filter across all six data categories by `organization`/`id` fields

### File modified
- `src/components/admin/DataRecoveryTool.tsx` (single file, all panels live here)

