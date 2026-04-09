

# Why Restored Reports Don't Appear in Dashboard Search

## Root Cause

When you restore a deleted report from the Data Recovery panel, the restore correctly sets `deleted_at = null` in the database. However, the Dashboard's in-memory report list is **not refreshed** afterward — it still holds the stale data from before the restore. Since the report was originally filtered out by `.is('deleted_at', null)` when it was deleted, it never made it into the current list, and restoring it server-side doesn't automatically re-fetch.

The Dashboard does auto-refresh on tab focus, visibility change, and pull-to-refresh — but if the restore happens within the same page (e.g., the Admin panel sheet), none of those browser events fire.

## Fix

**File: `src/components/admin/DeletedRecordsRecovery.tsx`**

After a successful restore, dispatch a custom event (e.g., `dashboard-stale`) that the Dashboard already listens for or can easily pick up. This triggers an automatic `refreshReports(true)` call.

**File: `src/pages/Dashboard.tsx`**

Add a listener for the `dashboard-stale` custom event that calls `refreshReports(true)`. This is the same pattern already used for sync-complete and visibility-change refreshes.

### Implementation Detail

1. In `DeletedRecordsRecovery.tsx`, after the `toast.success("Record restored successfully")` line, add:
   ```ts
   window.dispatchEvent(new CustomEvent('dashboard-stale'));
   ```

2. In `Dashboard.tsx`, inside the existing event-listener setup block (~line 434), add:
   ```ts
   const handleDashboardStale = () => refreshReports(true);
   window.addEventListener('dashboard-stale', handleDashboardStale);
   ```
   And clean it up in the return function.

This is a minimal, non-breaking change — two lines in each file.

