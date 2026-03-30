

## Fix: Dashboard Shows Zero Data After Navigating Back from Reports

### Root Cause

Three bugs combine to produce the "all zeros" issue when returning to Dashboard from any report form:

**Bug 1 — Session validation result is discarded.** In `refreshReports()`, `ensureValidSession()` is called but its return value is thrown away:
```typescript
// Current code (line 226-233):
await Promise.race([
  ensureValidSession(),     // <-- result ignored!
  new Promise(resolve => setTimeout(resolve, 3000))
]);
// ... proceeds to query Supabase regardless
```
If the JWT expired while the user was editing a report (common after 5+ minutes), the Supabase queries run with an invalid token. RLS silently returns `[]` (not an error), so the Dashboard interprets this as "server confirmed zero records."

**Bug 2 — Empty RLS result clears state unconditionally.** When the network returns `[]` (due to expired JWT) AND IndexedDB also returns `[]` (due to 2s timeout or circuit breaker), line 518 fires:
```typescript
else if (networkData !== null && offlineData.length === 0) {
  setInspections([]);  // Wipes everything!
}
```
There is no check for whether the session was actually valid.

**Bug 3 — No state preservation during failed loads.** The initial state comes from `sessionStorage` with a 5-minute TTL. If the user spent >5 minutes in a report, the cache expires, initial state is `[]`, and if the refresh fails (bugs 1+2), the user sees zeros with no recovery path except manual refresh.

### Changes

#### 1. `src/pages/Dashboard.tsx` — Use session validation result to gate network queries

In `refreshReports()`, capture the result of `ensureValidSession()`. If the session is invalid AND we're online, attempt one session refresh. If still invalid, skip network queries entirely and rely on offline/cached data:

```typescript
const refreshReports = async (force = false) => {
  // ... throttle checks ...
  
  let sessionValid = false;
  try {
    const sessionUser = await Promise.race([
      ensureValidSession(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 3000))
    ]);
    sessionValid = !!sessionUser;
  } catch { /* continue with offline data */ }

  const user = await getUserWithCache();
  const userId = user?.id || getOfflineUserId();
  const superAdminStatus = user && sessionValid ? await getSuperAdminStatusWithCache() : false;

  await Promise.all([
    loadInspections(userId, superAdminStatus, sessionValid),
    loadTrainingReports(userId, superAdminStatus, sessionValid),
    loadDailyAssessments(userId, superAdminStatus, sessionValid),
  ]);
  // ...
};
```

#### 2. `src/pages/Dashboard.tsx` — Guard network queries with `sessionValid` flag

Pass `sessionValid` to each load function. When `sessionValid` is `false`:
- Skip the Supabase network query (treat as offline)
- Never clear state to `[]` based on network results
- Use offline/cached data only

In each load function (inspections, trainings, assessments):
```typescript
// Only make network request if session is verified valid
if (navigator.onLine && sessionValid) {
  supabasePromise = withNetworkTimeout(/* ... */);
}

// Guard against clearing data without valid session
if (networkData && networkData.length > 0) {
  setInspections(networkData);
} else if (networkData !== null && offlineData.length === 0 && sessionValid) {
  // Only clear when session is VERIFIED valid and server confirmed zero
  setInspections([]);
}
```

#### 3. `src/pages/Dashboard.tsx` — Preserve last-known-good data during refresh

Never reset state to `[]` during a refresh if we already have data. Add a guard:
```typescript
// In each load function, before clearing:
if (networkData !== null && offlineData.length === 0 && sessionValid) {
  setInspections(prev => prev.length > 0 ? prev : []);
  // Only truly clear if we had no data before either
}
```

#### 4. `src/pages/Dashboard.tsx` — Extend sessionStorage cache TTL

Change `DASHBOARD_CACHE_TTL` from 5 minutes to 30 minutes. Users commonly spend 15-30 minutes on a report. The cache is just an initial-render optimization — it gets replaced by fresh data on successful load.

#### 5. `src/pages/Dashboard.tsx` — Add `popstate` listener for reliable back-navigation refresh

On iOS Safari, `focus` events are unreliable during SPA back-navigation. Add a `popstate` listener that forces a refresh when the user navigates back:

```typescript
const handlePopState = () => {
  if (location.pathname === '/dashboard') {
    refreshReports(true);
  }
};
window.addEventListener('popstate', handlePopState);
```

#### 6. `src/lib/sync-events.ts` — Add custom event for cross-component refresh

Add a `dashboard-refresh` custom DOM event that form pages dispatch before navigating away. This gives the Dashboard a synchronous signal to refresh immediately on mount, independent of `sessionStorage` flags:

```typescript
export function dispatchDashboardRefresh(): void {
  window.dispatchEvent(new CustomEvent('dashboard-refresh'));
}
```

#### 7. Report form pages — Dispatch refresh event on every exit

In `InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`, call `dispatchDashboardRefresh()` alongside the existing `markPendingDashboardRefresh()` on every navigation back to Dashboard. This ensures the Dashboard picks up the signal even if sessionStorage is unreliable.

### Files Modified
| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Session-gated network queries, preserve data on failed refresh, extended cache TTL, popstate listener |
| `src/lib/sync-events.ts` | Add `dispatchDashboardRefresh` custom event |
| `src/pages/InspectionForm.tsx` | Dispatch refresh event on exit |
| `src/pages/TrainingForm.tsx` | Dispatch refresh event on exit |
| `src/pages/DailyAssessmentForm.tsx` | Dispatch refresh event on exit |

### Impact
- Eliminates the "zero data" issue caused by expired JWT / RLS silent failures
- Data is never cleared unless we have verified proof the server has zero records
- Works on all platforms (iOS Safari, Android Chrome, desktop) since the fix is at the data-loading layer, not browser-event-dependent

