

# Why "Ariel Crawler World" Still Doesn't Appear

## Root Cause

The record is correctly restored in the database (`deleted_at = null`). The problem is **all 6 Supabase network queries are timing out after 15 seconds**, as shown in the console logs. The dashboard falls back to stale local cache, which doesn't contain this record (it was deleted before being cached).

Two compounding issues:

1. **Blocked refresh**: While the first `refreshReports` is stuck waiting for timeouts (~23s total: 8s session + 15s queries), the `refreshInFlightRef` guard silently drops all subsequent refresh attempts — including the `dashboard-stale` event we just added.

2. **No stale-data indicator**: When network fails, users see cached data with no warning that results may be incomplete.

## Fix

### 1. Prevent refresh stacking from blocking restore visibility

**File: `src/pages/Dashboard.tsx`**

When `refreshInFlightRef` blocks a `dashboard-stale` triggered refresh, queue it so it runs immediately after the current in-flight refresh completes, rather than being silently dropped.

Add a `pendingRefreshRef` flag:
- When `refreshReports` is called while in-flight, set `pendingRefreshRef.current = true`
- In the `finally` block after clearing `refreshInFlightRef`, check `pendingRefreshRef` and re-trigger if set

### 2. Show network status feedback when queries fail

**File: `src/pages/Dashboard.tsx`**

Track when all network queries have timed out and show a subtle banner: "Unable to reach server — showing cached data. Pull to refresh."

This tells users that search results may be incomplete, prompting a manual retry.

### 3. Investigate query timeout root cause

The queries are lean (no `latest_report_html`), so 15s timeouts suggest a transient network or Supabase connectivity issue in the preview environment. No code change needed, but worth monitoring. If persistent, consider:
- Reducing the session validation timeout from 8s to 4s
- Running the 3 `load*` functions with independent session checks so one slow query doesn't block the others (they already run in `Promise.all`, but they share the same `sessionValid` gate)

## Summary of Changes

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Queue pending refresh when in-flight refresh blocks a new request |
| `src/pages/Dashboard.tsx` | Add stale-data indicator when all network queries time out |

