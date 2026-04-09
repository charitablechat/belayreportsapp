

# Move "Invoiced" Tab to Right of "Daily" Tab (Always Visible for Admins)

## Summary
Reposition the "Invoiced" tab to appear immediately after the "Daily" tab, and always show it for admins/super admins regardless of count.

## Changes

### `src/components/dashboard/DashboardReportsSection.tsx`
- The Invoiced tab is already positioned after Daily (lines 424-429) — so the ordering is correct
- **Only change needed**: Remove the `invoicedReports.length > 0` condition so the tab always shows for super admins even when empty
- Change line 424 from `{isSuperAdmin && invoicedReports.length > 0 && (` to `{isSuperAdmin && (`

