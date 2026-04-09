

# Fix: Dashboard Auto-Reload Lag When Exiting Reports

## Root Cause

When navigating back from a report to the dashboard, `refreshReports(true)` runs a **sequential session validation cascade** before loading any data:

1. Check `navigator.onLine` — if briefly false (common on iOS transitions), **wait 1 second** (line 304)
2. Call `ensureValidSession()` with **8-second timeout** (line 314)
3. If that fails, **wait 2 seconds**, then retry with a **5-second timeout** (lines 324-330)
4. Only THEN call `getUserWithCache()` and load reports

**Worst case: 16 seconds before data even starts loading.** Even in the happy path, `ensureValidSession()` calls `supabase.auth.getSession()` which involves a LockManager acquisition and can take 1-3 seconds on mobile.

Meanwhile, the stale timestamp marker (lines 452-454) is consumed but **has zero effect** — it just logs. It doesn't fast-track anything.

## Solution: Fast-Path for Report-Exit Navigation

When the dashboard detects a stale marker (meaning the user just came from a report form where they were authenticated seconds ago), **skip the session validation entirely for the initial load** and use the in-memory cached user. Then do a background session-validated refresh afterward.

### Changes

**File: `src/pages/Dashboard.tsx`**

1. **Add a `skipSessionValidation` parameter to `refreshReports`** — when `true`, skip the `ensureValidSession()` cascade entirely and trust `getUserWithCache()` (which has a 1-minute in-memory cache).

2. **On mount, detect stale marker and use fast path**:
   ```
   // Line 452: Instead of just logging, set a flag
   const hasStaleMarker = consumeDashboardStaleTimestamp() || consumePendingDashboardRefresh();
   ```
   
   Then on line 389:
   ```
   // Fast load with cached auth, then background-validate
   refreshReports(true, hasStaleMarker).then(() => {
     if (hasStaleMarker) {
       // Background: re-validate session and refresh again if needed
       setTimeout(() => refreshReports(true), 500);
     }
   });
   ```

3. **Inside `refreshReports`, when `skipSessionValidation` is true**:
   - Skip the 1s offline recheck (we were just online in the report form)
   - Skip the `ensureValidSession()` + retry cascade
   - Set `sessionValid = true` and `effectiveOnline = true` directly
   - Proceed straight to `getUserWithCache()` → load data

This turns a 3-8 second wait into ~50ms (in-memory cache hit + parallel DB queries).

### Why This Is Safe

- The user was authenticated seconds ago in the report form — the cached auth token is valid
- `getUserWithCache()` has a 1-minute TTL and will return the cached user instantly
- The background refresh (500ms later) will do full session validation and correct any stale data
- If the fast path somehow fails (e.g., expired token), the load functions fall back to cached/offline data, and the background refresh will fix it

### Summary

One file edited (`Dashboard.tsx`), ~15 lines changed. The fix eliminates the session validation bottleneck for the most common navigation pattern (report → dashboard) while preserving all safety mechanisms for cold starts and edge cases.

