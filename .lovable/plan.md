

# Fix: Dashboard Report Count Flashing (8 to 17)

## Root Cause

The Dashboard uses a "cache-first, then network" loading pattern. Every time data loads:

1. It fetches from IndexedDB (local cache) and immediately displays it (e.g., 8 reports)
2. Then fetches from the server and replaces the list (e.g., 17 reports)
3. Background sync completes and fires a `syncComplete` event
4. The event triggers a full reload, repeating steps 1-2 (flash: 8 -> 17 again)

The IndexedDB cache is stale because orphan cleanup (which removes old records) runs *after* the network data is displayed, meaning the next cache read still returns the old count.

## Solution

**Only show IndexedDB data as a placeholder when nothing is currently displayed.** If we already have reports on screen (from a previous network fetch), skip the cache step and wait for the network response silently.

### Change in `src/pages/Dashboard.tsx`

In `loadInspections`, `loadTrainingReports`, and `loadDailyAssessments`:

**Before (current behavior -- always overwrites with cache):**
```
const offlineData = await offlineWithTimeout;
if (offlineData.length > 0) {
  setInspections(offlineData);  // <-- causes flash
}
```

**After (only use cache when list is empty):**
```
const offlineData = await offlineWithTimeout;
if (offlineData.length > 0 && inspections.length === 0) {
  setInspections(offlineData);  // only on first load
}
```

This same pattern applies to all three loader functions:
- `loadInspections` (~line 367): guard with `inspections.length === 0`
- `loadTrainingReports` (~line 460): guard with `trainings.length === 0`
- `loadDailyAssessments` (~line 550): guard with `dailyAssessments.length === 0`

Since these functions are defined inside the component, they have access to the current state. The guard ensures cached data only appears during the initial skeleton-loading phase, not during subsequent reloads triggered by sync events.

### What This Fixes

- No more visible count jumping (8 -> 17 -> 8 -> 17)
- First load still shows cached data instantly (fast perceived load)
- Sync-triggered reloads go straight to network data without the intermediate flash
- Orphan cleanup continues to work normally in the background

### What Does NOT Change

- Offline behavior (cache is still the primary source when offline)
- Network fetch logic (still runs the same queries)
- Sync event handling (still reloads on sync complete)
- Orphan cleanup (still removes stale local records)

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Add `currentState.length === 0` guard to cache display in all 3 loaders |

