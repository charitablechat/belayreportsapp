

## Add Search to Data Recovery Panels

### What Changes

Add a search bar to the **Cloud**, **All Users**, and **Local** snapshot panels in `DataRecoveryTool.tsx` that filters by facility name and user name.

### Implementation

**1. Create a reusable `RecoverySearchBar` component** (inline in `DataRecoveryTool.tsx`)

A simple debounced search input (reuse the pattern from `DashboardSearchBar`) with placeholder "Search by facility or user...". Uses local state with 300ms debounce.

**2. Add search state + filtering to each panel:**

- **`CloudSnapshotsPanel`**: Add `searchQuery` state. Filter `snapshots` by matching `facility` or `user_name` against the query (case-insensitive). Render `RecoverySearchBar` between the header and content.

- **`AllUserSnapshotsPanel`**: Same approach. Filter before grouping by user — both `user_name` and `facility` fields are available on each snapshot entry. The search filters the flat list before the `reduce` grouping step.

- **`LocalSnapshotsPanel`**: Add `searchQuery` state. Local snapshots have `organization` field (equivalent to facility) but no `user_name`. Filter by `organization` only. Search placeholder adjusted to "Search by organization...".

**3. Filter logic** (same for all panels):

```typescript
const filtered = snapshots.filter(s => {
  if (!query) return true;
  const q = query.toLowerCase();
  return (s.facility || s.organization || '').toLowerCase().includes(q)
      || (s.user_name || '').toLowerCase().includes(q);
});
```

Render `filtered` instead of `snapshots` in the list/table. Show "No results" message when filtered is empty but snapshots exist.

### Files Modified
- `src/components/admin/DataRecoveryTool.tsx` — add search input + filter logic to 3 panels

