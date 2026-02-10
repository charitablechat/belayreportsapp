

# Fix: Inspection Count Flashing (11 to 7) on Dashboard

## What's Happening

You're seeing 11 reports briefly, then 7. Those extra 4 are **stale records in IndexedDB** (local cache) that no longer exist on the server -- they were either deleted or belong to old sessions. Since you're a super admin, the local cache returns ALL stored records without user filtering, including orphans.

The sequence on every page load:
1. IndexedDB returns 11 cached records (including 4 orphans) -- displayed immediately
2. Server returns the real 7 records -- replaces the list
3. Orphan cleanup removes the 4 stale records from cache (but too late, the flash already happened)

## Solution

**Wait for the network response when online instead of showing stale cache first.** The cache-first pattern was designed for offline/slow-network scenarios, but when online it creates this flash. The fix:

- When **online**: Skip displaying cached data entirely. Show skeleton loaders until the server responds (typically under 1 second). Cache is only used if the network request fails.
- When **offline**: Continue showing cached data immediately (no change to offline behavior).

This eliminates the flash completely because there's only one data source displayed per load cycle.

## Technical Detail

### File: `src/pages/Dashboard.tsx`

In all three loader functions (`loadInspections`, `loadTrainingReports`, `loadDailyAssessments`), change the cache display logic:

**Current behavior:**
```
const offlineData = await offlineWithTimeout;
if (offlineData.length > 0 && inspections.length === 0) {
  setInspections(offlineData);  // shows stale cache, then server overwrites = flash
}
```

**New behavior:**
```
const offlineData = await offlineWithTimeout;
if (offlineData.length > 0 && !navigator.onLine) {
  setInspections(offlineData);  // only show cache when truly offline
}
```

Apply this same change in all three loaders:
- `loadInspections` (around line 366)
- `loadTrainingReports` (equivalent location)
- `loadDailyAssessments` (equivalent location)

The rest of the function stays the same -- the network fetch path already handles the online case correctly, and the fallback for network failure (`networkData === null && offlineData.length > 0`) still kicks in.

### What This Fixes
- No more count flashing (11 to 7, or 8 to 17)
- Skeleton loaders show for ~1 second on page load until server responds
- Offline experience unchanged -- cache displays instantly

### What Does NOT Change
- Network fetch logic
- Orphan cleanup (still runs after network data loads)
- Sync event handling
- Offline-first behavior when network is unavailable

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Change cache display guard from `inspections.length === 0` to `!navigator.onLine` in all 3 loaders |

