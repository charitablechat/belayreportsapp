

# Comprehensive Application Audit and Fix Plan

## Issues Found

### CRITICAL: Dashboard Zeros on Report Exit (P0)

**Root Cause**: When navigating from a report back to the dashboard, the stats bar briefly (or persistently) shows all zeros. Two interacting problems:

1. **Stats bar lacks a `dataValidated` guard.** The tab badge counts (line 528) correctly show `…` while data loads by checking `totalInspections` (which is `undefined` until `dataValidated = true`). But the `DashboardStatsBar` at line 251-257 computes stats directly from `currentReports.length`, which can be `0` during the loading/revalidation window.

2. **Stale-while-revalidate guard drops data.** In `loadInspections` (line 632): `setInspections(prev => prev.length === 0 ? offlineData : prev)`. When the dashboard *remounts* after exiting a report, `readDashboardCache` may return `[]` (expired 30-min TTL or first visit), so initial state is `[]`. If IndexedDB times out (4s), the state stays `[]`. Then `loading` goes `false` and the stats bar renders zeros. The subsequent 500ms background refresh (line 408) eventually populates data, causing a flash of zeros.

3. **Network data path can also produce zeros.** When `networkData` is a non-null empty array (user has zero reports of a type — rare but valid), the logic at line 737-739 does `setInspections(prev => prev.length > 0 ? prev : [])` which is a no-op. But the stats bar still reads the empty array.

**Fix**: Propagate the `dataValidated` flag into `DashboardReportsSection` and gate the stats bar on it, matching the tab badge pattern. While `dataValidated` is false, show skeleton/placeholder stats instead of zeros.

### Issue 2: `fetchUser` in InspectionForm Still Uses 4-Layer Auth (P2)

The `performSave` auth gate was removed (previous approved plan), but `fetchUser` on mount (lines 467-476) still uses the same multi-layer pattern with `ensureValidSession`. This is inconsistent and can cause the `currentUser` state to be null if the session refresh times out, meaning `last_modified_by` never gets stamped even when a cached user exists.

**Fix**: Simplify `fetchUser` to use `getUserWithCache()` with `getOfflineUserId()` fallback only — remove the `ensureValidSession()` call. This matches the save path and the other form patterns.

### Issue 3: Dashboard `loadInspections` Stale Guard Drops Cached Data (P1)

The line `setInspections(prev => prev.length === 0 ? offlineData : prev)` is too conservative. If the component just remounted (state initialized from cache), `prev` may already have stale cached data from `readDashboardCache`. But if IndexedDB returns fresher data, it gets dropped because `prev.length > 0`. Conversely, if cache was empty, IndexedDB data that arrives later than the 4s timeout is also lost.

**Fix**: Always set offline data when it arrives (remove the `prev.length === 0` guard), then let network data overwrite it. The stale-while-revalidate pattern should be: show whatever arrives first, then replace with network data.

### Issue 4: `handleSaveAndLeave` Race in InspectionForm (P2)

At lines 2461-2474, the save-before-leave wraps `handleSaveAndLeave()` in a `Promise.race` with an 8s timeout, then calls `bypassAndProceed()` + `navigate('/dashboard')`. But `bypassAndProceed` calls `blocker.proceed()` which may navigate to a stale history entry, and then `navigate('/dashboard')` fires again — potentially causing a double navigation.

**Fix**: Remove `bypassAndProceed()` from both the `onSave` and `onLeave` callbacks since `navigate('/dashboard')` already handles the navigation. The `bypassRef` should be set directly instead.

### Issue 5: Duplicate `navigate('/dashboard')` Calls (P2)

All three form `SaveBeforeLeaveDialog` handlers call both `bypassAndProceed()` and `navigate('/dashboard')`. The `useUnsavedChanges.confirmNavigation` already does `blocker.reset() + navigate(fallbackPath)`. Having both creates a race.

**Fix**: Use the same pattern as `confirmNavigation` — set `bypassRef.current = true`, call `blocker.reset()`, then `navigate('/dashboard')`. Remove the redundant `bypassAndProceed()`.

### Issue 6: Profile Cache Missing `acct_number` in Type Export (P3)

The `ProfileData` interface and `getCachedProfile` were updated to include `acct_number`, but the `persistProfileToLocalStorage` and `getPersistedProfile` functions need to be verified as working correctly with the new field.

**Status**: Already fixed in previous plan implementation. Verified correct.

---

## Implementation Plan

### File 1: `src/components/dashboard/DashboardReportsSection.tsx`

**Gate stats bar on `dataValidated`:**
- Add `dataValidated?: boolean` to props interface
- Change stats bar render condition from `!loading && !isSearchActive` to `!loading && !isSearchActive && dataValidated !== false`
- When `dataValidated` is false and not loading, show a subtle skeleton placeholder for stats

### File 2: `src/pages/Dashboard.tsx`

**Pass `dataValidated` to `DashboardReportsSection`:**
- Add `dataValidated={dataValidated}` prop at line ~1553

**Fix stale-while-revalidate guard:**
- In `loadInspections`, `loadTrainingReports`, `loadDailyAssessments`: change `setX(prev => prev.length === 0 ? offlineData : prev)` to always set when offline data is more recent or prev is from expired cache
- Simpler fix: always `setX(offlineData)` when offline data arrives (network data will overwrite shortly after)

### File 3: `src/pages/InspectionForm.tsx`

**Simplify `fetchUser` (lines 467-476):**
- Remove `ensureValidSession()` call
- Use `getUserWithCache()` with `getOfflineUserId()` fallback only

**Fix `SaveBeforeLeaveDialog` handlers (lines 2454-2486):**
- Remove `bypassAndProceed()` calls
- Use direct `bypassRef` pattern before `navigate('/dashboard')`

### File 4: `src/pages/TrainingForm.tsx`

**Fix `SaveBeforeLeaveDialog` handlers** — same pattern as InspectionForm

### File 5: `src/pages/DailyAssessmentForm.tsx`

**Fix `SaveBeforeLeaveDialog` handlers** — same pattern as InspectionForm

### File 6: `src/components/dashboard/DashboardStatsBar.tsx`

**Add loading/skeleton state:**
- Accept optional `dataValidated` prop
- When false, show animated placeholder values instead of zeros

## Summary

The primary fix addresses the zeros problem by:
1. Gating stats display on `dataValidated` (matching existing tab badge pattern)
2. Fixing the stale-while-revalidate guard that drops offline data when cache is populated
3. Cleaning up navigation race conditions in all three form exit flows

