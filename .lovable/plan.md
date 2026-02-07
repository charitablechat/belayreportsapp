

# Fix Plan: Dashboard Reports Showing Zero - v2.4.6

## Root Cause

The data loading functions in `Dashboard.tsx` cannot distinguish between **"the server confirmed zero records"** and **"the network request failed/timed out"**. Both cases produce an empty array `[]`, which triggers the explicit `setInspections([])` call that wipes any previously displayed data.

### The Vulnerable Code Pattern (repeated 3x)

```text
// Lines 348-364 (inspections), ~420-434 (trainings), ~490-504 (daily assessments)
if (networkData.length > 0) {
  setInspections(networkData);         // OK - replaces with fresh data
} else if (offlineData.length === 0) {
  setInspections([]);                  // BUG - wipes data on failed fetch
}
```

### How Zero Reports Occurs

1. User exits a report, Dashboard remounts
2. `loadAllData()` starts initial data fetch
3. Sync-complete event fires (line 255), triggering a SECOND parallel fetch
4. If the second fetch's IndexedDB times out (2s limit) AND the network request fails/times out (6s limit):
   - `offlineData = []` (timeout fallback)
   - `networkData = []` (error/timeout fallback)
   - `setInspections([])` overwrites the data loaded by the first fetch
5. Dashboard displays "0 reports"

### Why Errors and Timeouts Return `[]`

Both error handlers silently return empty arrays:

```text
// Network error catch (line 324-326):
.catch(err => { return []; })

// Network timeout fallback (line 328-329):
withNetworkTimeout(..., 6000, [])

// IndexedDB timeout (line 336):
new Promise(resolve => setTimeout(() => resolve([]), 2000))
```

There is no way to tell "server said zero" from "request failed."

---

## Solution

Use `null` to represent fetch failures and empty arrays `[]` only for confirmed empty results. Only clear displayed data when the network definitively confirms zero records.

### File: `src/pages/Dashboard.tsx`

**Change 1: Update `withNetworkTimeout` return type** (lines 281-293)

Change the timeout helper to support `null` fallback values so callers can distinguish timeout from empty.

**Change 2: Fix `loadInspections`** (lines 295-369)

- Change `.catch()` to return `null` instead of `[]`
- Change timeout fallback to `null`
- Update conditional: only `setInspections([])` when `networkData` is an actual empty array (not null)

Before:
```
.catch(err => { return []; })
...
withNetworkTimeout(..., 6000, [])
...
if (networkData.length > 0) {
  setInspections(networkData);
} else if (offlineData.length === 0) {
  setInspections([]);
}
```

After:
```
.catch(err => { return null; })
...
withNetworkTimeout(..., 6000, null)
...
if (networkData && networkData.length > 0) {
  setInspections(networkData);
} else if (networkData !== null && offlineData.length === 0) {
  // Only clear when server CONFIRMED zero records (not timeout/error)
  setInspections([]);
}
```

**Change 3: Apply same fix to `loadTrainingReports`** (lines 371-439)

Same pattern: `.catch` returns `null`, timeout fallback is `null`, conditional checks `networkData !== null`.

**Change 4: Apply same fix to `loadDailyAssessments`** (lines 441-509)

Same pattern for daily assessments.

### Phase 2: Version Bump

Update `vite.config.ts` to **v2.4.6**.

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/pages/Dashboard.tsx` | Update | Distinguish fetch failures (null) from confirmed empty results ([]) in all 3 load functions |
| `vite.config.ts` | Update | Bump to v2.4.6 |

---

## Why This Fixes the Issue

| Scenario | Before (broken) | After (fixed) |
|----------|-----------------|---------------|
| Server returns 0 records | Sets [] (correct) | Sets [] (correct) |
| Network times out | Sets [] (WRONG - wipes data) | Preserves existing data |
| Network error (auth, etc.) | Sets [] (WRONG - wipes data) | Preserves existing data |
| Sync-complete reload races | Can wipe first load's data | Safely preserves displayed data |

---

## Testing Checklist

- [ ] Navigate in and out of reports - counts remain correct
- [ ] Delete a report and verify count decreases by 1
- [ ] Verify empty state still shows when user truly has 0 reports (new account)
- [ ] Test on slow network to verify timeout doesn't wipe data
- [ ] Verify sync-complete event doesn't cause count flicker

