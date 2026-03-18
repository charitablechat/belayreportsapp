

## Fix: Dashboard Shows '0' Reports After Navigation

### Root Cause

The Dashboard's main `useEffect` (line 196-381) depends on `[location.pathname]`. When navigating `/dashboard` → `/inspection/123` → `/dashboard`, the pathname is `/dashboard` both times. React Router v6's `createBrowserRouter` **does** remount the component, so the effect runs on mount. However, the problem is a **session race condition**:

1. `ensureValidSession()` fires non-blocking (line 202) — session refresh happens in background
2. `getUserWithCache()` is called immediately — if the cached session token expired while the user was editing an inspection, `getCachedUserFromStorage()` returns `null` (line 298-301 checks `expiresAt`)
3. The Supabase queries run with a potentially expired/stale session → fail silently → component state stays at `[]`
4. The retry at line 255 fires after 1.5s, but if the session still hasn't refreshed, it fails again
5. Manual page refresh works because the Supabase client's `autoRefreshToken` has time to complete during full page load

Additionally, `dataLoadedRef` (line 249) is never updated to `true`, making the retry detection unreliable.

### Solution

Two changes:

**1. Make session validation blocking before data fetch** (in `loadAllData`)
- Change `ensureValidSession()` from fire-and-forget to awaited with a short timeout (3s)
- This ensures the Supabase client has a valid token before any queries run
- Fall back to cached auth if the refresh times out (preserves offline-first behavior)

**2. Use `location.key` instead of `location.pathname` as the useEffect dependency**
- `location.key` is unique per navigation entry, even when navigating to the same path
- This guarantees the effect re-runs on every navigation to `/dashboard`, even if React reuses the component instance

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | (1) Await `ensureValidSession()` with 3s timeout before data fetch. (2) Change useEffect dep from `location.pathname` to `location.key`. |

### Risk
- Blocking on session adds up to 3s latency on expired sessions — but this is better than showing 0 reports
- Offline path unaffected: `ensureValidSession` timeout falls through to cached auth

