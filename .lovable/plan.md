

# Make Dashboard Loading Near-Instant

## Problem

When online, the dashboard suppresses all cached/offline data and shows skeleton loaders until the network responds (up to 8-15 seconds). This happens because the code at three points explicitly checks `!navigator.onLine` before showing IndexedDB data:

```js
// Current: only shows cached data when OFFLINE
if (offlineData.length > 0 && !navigator.onLine) {
  setInspections(offlineData);
}
```

## Solution: Show Cached Data Immediately, Replace Silently

Remove the `!navigator.onLine` guard so IndexedDB data displays instantly as a placeholder. Network data replaces it silently when it arrives (typically 1-2 seconds later). This gives users a near-instant dashboard on every load.

## Changes (single file)

### `src/pages/Dashboard.tsx`

**1. Show offline data immediately regardless of network status** (3 locations)

For `loadInspections` (~line 353), `loadTrainingReports` (~line 446), and `loadDailyAssessments` (~line 537):

```js
// BEFORE:
if (offlineData.length > 0 && !navigator.onLine) {
  setInspections(offlineData);
}

// AFTER:
if (offlineData.length > 0) {
  setInspections(offlineData);
  // When online, also clear loading immediately since we have cached data to show
  if (navigator.onLine) {
    setLoading(false);
  }
}
```

This applies identically to `setTrainings(offlineData)` and `setDailyAssessments(offlineData)`.

**2. No other changes needed**

- The network fetch already runs in parallel and calls `setInspections(networkData)` when it completes, silently replacing the cached data
- The orphan cleanup and synced_at stamping continue to work as before
- The "only clear on confirmed zero" safety guard remains intact

## Expected Behavior

| Scenario | Before | After |
|----------|--------|-------|
| Online, cached data exists | Skeleton for 1-8s until network responds | Cached data shown instantly; network data swaps in silently |
| Online, no cached data | Skeleton until network responds | Same (no change -- nothing to show early) |
| Offline | Cached data shown instantly | Same (no change) |
| First-ever load | Skeleton until network responds | Same (no change -- no cache yet) |

## Risk Assessment

- **Flicker concern**: The previous code suppressed offline data online to prevent "count toggling" (e.g., 6 items from cache, then 7 from network). This is acceptable -- a brief count change is far better than staring at skeletons for seconds. The data content is the same; only newly-created reports from other devices would differ.
- **No data loss risk**: Network data always overwrites cached data when available.

