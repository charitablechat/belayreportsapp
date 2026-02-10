

# Fix Training Report Count Flickering (6 to 7 Toggle)

## Root Cause

The `loadTrainingReports()` function (and all three loaders) uses a **parallel loading pattern** that calls `setTrainings()` twice in rapid succession:

1. **First call** (line 438): Sets state with IndexedDB offline data (e.g., 6 items)
2. **Second call** (line 448): Sets state with fresh network data (e.g., 7 items)

Since the tab label renders `Training ({trainings.length})`, the count visibly flickers between the two values on every reload. This is triggered by:
- Initial page load
- Online/offline events
- Sync-complete events
- Pull-to-refresh

The pattern exists identically in `loadInspections()` and `loadDailyAssessments()`, but the training tab is where the mismatch is most visible (likely because the offline cache has one fewer record than the server).

## Solution

**When online**, skip the early `setTrainings(offlineData)` call. Instead, use offline data only as a fallback if the network request fails or returns null. This eliminates the double-state-set that causes flickering.

**When offline**, the behavior stays the same -- offline data is shown immediately.

### File: `src/pages/Dashboard.tsx`

Apply the same fix to all three loader functions:

**`loadTrainingReports()` (lines 437-442):**
Change the early offline-data state set to only fire when NOT online:
```tsx
if (offlineData.length > 0 && !navigator.onLine) {
  setTrainings(offlineData);
}
```
Then after the network block, add a final fallback: if we're online but network returned null (error/timeout), use offline data:
```tsx
} else if (networkData === null && offlineData.length > 0) {
  // Network failed -- fall back to offline data
  setTrainings(offlineData);
}
```

**`loadInspections()` (lines 347-352):**
Same pattern -- guard the early `setInspections(offlineData)` with `!navigator.onLine`, add network-failure fallback.

**`loadDailyAssessments()` (equivalent lines):**
Same pattern for consistency.

## Summary of changes

- 3 functions modified in `src/pages/Dashboard.tsx`
- Each change: guard the early offline-data `setState` call to only fire when offline
- Each change: add a fallback branch so offline data is used when network fails
- No new UI, no new dependencies, no logic changes elsewhere
- Result: each loader calls `setState` exactly once per reload cycle, eliminating the flicker

