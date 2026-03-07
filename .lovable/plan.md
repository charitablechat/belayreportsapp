

## Show Last 9 Completed Reports When "Completed" Sort Is Selected

When the user selects "Completed" from the sort dropdown, the dashboard should switch to showing **only** completed reports (not drafts), limited to the 9 most recent. Super admins see completed reports from all users; non-admins see only their own.

### Changes

**1. `src/hooks/useDashboardFilters.tsx`**
- Add `isSuperAdmin: boolean` parameter to the hook signature
- After sorting, when `sortBy === 'completed'`:
  - Filter to only completed reports (`status === 'completed'`)
  - For non-super-admins, further filter to `inspector_id === currentUserId`
  - Sort by date descending and take only the first 9
  - Skip the normal tier separation and grouping — just return a single "Completed" group with those 9 items
  - Skip pagination (9 items fits in one page)

**2. `src/components/dashboard/DashboardReportsSection.tsx`**
- Pass `isSuperAdmin` prop through to the `useDashboardFilters` hook call

### Logic Flow (in `useDashboardFilters`)
```
if (sortBy === 'completed') {
  // Filter completed only
  let completed = filtered.filter(r => r.status === 'completed');
  // Non-admin: own reports only
  if (!isSuperAdmin && currentUserId) {
    completed = completed.filter(r => r.inspector_id === currentUserId);
  }
  // Sort by date desc, take 9
  completed.sort((a, b) => {
    const da = getReportDate(a, type) || '';
    const db = getReportDate(b, type) || '';
    return db.localeCompare(da);
  });
  completed = completed.slice(0, 9);
  // Return single group, no pagination needed
  groups = [{ label: 'Last 9 Completed', count: completed.length, items: completed }];
  // skip normal tier/group/pagination logic
}
```

