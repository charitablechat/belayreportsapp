

## Fix: Dashboard Not Refreshing Reports on Return Navigation

### Root Cause

The main data-loading `useEffect` (line 251) depends on `[location.key]`. When the user navigates back to `/dashboard` via browser back button or swipe-back, React Router restores the previous history entry **with the same `location.key`**. Since the key hasn't changed, the useEffect doesn't re-run, leaving stale (or empty) data on screen.

Additionally, the `visibilitychange` and `focus` event handlers call `refreshReports()` **without** `force=true`, making them subject to the 3-second throttle — which can silently skip the refresh if the last fetch was recent.

### Fix (1 file: `src/pages/Dashboard.tsx`)

#### 1. Change useEffect dependency from `[location.key]` to `[]`
The Dashboard component fully unmounts/remounts on forward navigation (different route elements). The `location.key` dependency was meant to handle re-entries, but it fails on back-navigation. Using `[]` ensures the initial load always fires on mount.

#### 2. Force-refresh on visibility/focus events
Change the `handleVisibilityChange` and `handleWindowFocus` handlers to pass `force=true`:

```typescript
// Line 311-312
const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible') refreshReports(true);
};

// Line 316
const handleWindowFocus = () => refreshReports(true);
```

This ensures that when the user returns to the Dashboard tab (via browser back, swipe-back, or tab switch), data is always re-fetched regardless of the throttle window.

#### 3. Keep `pageshow` handler as-is
The `handlePageShow` handler already uses `force=true` for bfcache restores — no change needed.

### Result
- Returning to Dashboard via any navigation method (back button, swipe-back, link, tab switch) triggers a fresh data load
- The 3-second throttle still prevents redundant rapid-fire refreshes during normal use (e.g., pull-to-refresh)
- No performance regression — `refreshInFlightRef` guard prevents concurrent fetches

