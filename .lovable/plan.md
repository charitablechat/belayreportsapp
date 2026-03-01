

## Fix: Dashboard Reports Not Loading After Exiting a Report

### Root Cause Analysis (Prioritized)

**1. `ensureValidSession()` blocking the critical path (HIGH)**
When navigating back to the Dashboard, `ensureValidSession()` can block for up to 5 seconds (its timeout). This leaves only 3 seconds before the 8-second safety timeout forces `setLoading(false)`. If the Supabase queries haven't completed by then, the user sees an empty dashboard. The queries may also fail silently with stale auth tokens if the session refresh didn't complete.

**2. `location.key` doesn't change on `navigate(-1)` (MEDIUM)**
The current fix adds `location.key` as a `useEffect` dependency, but `navigate(-1)` restores the previous history entry with its **original key**. Since React Router reuses the same key, the dependency doesn't trigger a re-run. However, this is mitigated by the fact that the Dashboard component fully unmounts/remounts when navigating between sibling routes.

**3. No retry or fallback when both data sources return empty (MEDIUM)**
If IndexedDB times out (returns `[]`) AND the Supabase query fails (returns `null`), the Dashboard falls through without setting any data, leaving the initial empty `[]` state. There's no automatic retry.

**4. No visibility/focus-based reload (LOW)**
When the browser tab regains focus or the app comes back from background (common on mobile), there's no trigger to reload stale data.

### Solution (4 Changes)

#### 1. Make `ensureValidSession()` non-blocking
Move the session validation out of the critical loading path. Fire it as a background task so data loading starts immediately using cached auth.

**File:** `src/pages/Dashboard.tsx` (inside the `loadAllData` function, lines 194-201)

Replace the blocking `await` with a fire-and-forget call:
```typescript
// NON-BLOCKING: Start session refresh in background
// Data loading uses getUserWithCache() which reads from localStorage instantly
ensureValidSession().catch(e => {
  console.warn('[Dashboard] Background session refresh failed:', e);
});
```

#### 2. Add automatic retry when load returns empty while online
After the initial `loadAllData()` completes, if all three data arrays are still empty and we're online, schedule a retry after a short delay. This catches cases where the first attempt failed due to a stale token that has since been refreshed by the background `ensureValidSession()`.

**File:** `src/pages/Dashboard.tsx` (after `loadAllData().then(...)`, around line 245)

```typescript
loadAllData().then(() => {
  // Retry if initial load came back empty while online
  // (session may have been stale; ensureValidSession runs in background)
  if (navigator.onLine && inspections.length === 0 && trainings.length === 0 && dailyAssessments.length === 0) {
    setTimeout(async () => {
      const user = await getUserWithCache();
      const userId = user?.id || getOfflineUserId();
      const superAdminStatus = user ? await getSuperAdminStatusWithCache() : false;
      await Promise.all([
        loadInspections(userId, superAdminStatus),
        loadTrainingReports(userId, superAdminStatus),
        loadDailyAssessments(userId, superAdminStatus),
      ]);
    }, 1500); // 1.5s delay gives ensureValidSession time to complete
  }

  // Existing pending refresh logic...
  if (hasPendingRefresh) { ... }
});
```

Note: Since `inspections`, `trainings`, and `dailyAssessments` are read from the closure at `.then()` time, we'll use refs to track whether data was loaded to avoid stale closure issues.

#### 3. Add `visibilitychange` listener for tab-focus reloads
When the user switches tabs/apps and comes back, reload data automatically. This is especially important on mobile where the browser may suspend the page.

**File:** `src/pages/Dashboard.tsx` (inside the main `useEffect`, before the cleanup return)

```typescript
// Reload data when tab regains focus (e.g., after switching apps on mobile)
const handleVisibilityChange = async () => {
  if (document.visibilityState === 'visible' && navigator.onLine) {
    const user = await getUserWithCache();
    const userId = user?.id || getOfflineUserId();
    const superAdminStatus = user ? await getSuperAdminStatusWithCache() : false;
    await Promise.all([
      loadInspections(userId, superAdminStatus),
      loadTrainingReports(userId, superAdminStatus),
      loadDailyAssessments(userId, superAdminStatus),
    ]);
  }
};
document.addEventListener('visibilitychange', handleVisibilityChange);
```

Add cleanup in the return function:
```typescript
document.removeEventListener('visibilitychange', handleVisibilityChange);
```

#### 4. Replace `goBack(navigate)` with `navigate('/dashboard')` in exit handlers
This creates a **new** history entry with a **new** `location.key`, guaranteeing the `useEffect` re-fires. This also avoids edge cases where `navigate(-1)` could go to an unexpected page if the navigation stack was modified.

**Files:** `src/pages/InspectionForm.tsx`, `src/pages/TrainingForm.tsx`, `src/pages/DailyAssessmentForm.tsx`

In both the `onSave` and `onLeave` handlers of the `SaveBeforeLeaveDialog`, replace:
```typescript
goBack(navigate);
```
with:
```typescript
navigate('/dashboard');
```

### Files Changed Summary

| File | Changes |
|------|---------|
| `src/pages/Dashboard.tsx` | Make `ensureValidSession` non-blocking; add empty-data retry with ref tracking; add `visibilitychange` listener |
| `src/pages/InspectionForm.tsx` | Replace `goBack(navigate)` with `navigate('/dashboard')` in save and discard exit handlers |
| `src/pages/TrainingForm.tsx` | Replace `goBack(navigate)` with `navigate('/dashboard')` in save and discard exit handlers |
| `src/pages/DailyAssessmentForm.tsx` | Replace `goBack(navigate)` with `navigate('/dashboard')` in save and discard exit handlers |

