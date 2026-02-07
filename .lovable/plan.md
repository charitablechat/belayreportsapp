

# Fix Offline Sign-In with Expired Cached Sessions - v2.4.14

## Problem

Supabase JWT tokens expire after approximately 1 hour. The current code checks `expires_at` and rejects expired tokens even when offline. This means if you were last online more than an hour ago and then go offline, you cannot access the app -- even though all report data is stored locally in IndexedDB.

Two places enforce this check:
1. **`Index.tsx` (line 25)**: Rejects expired cached sessions, falls through to show the Auth screen
2. **`cached-auth.ts` (`getCachedUserFromStorage`, line 180)**: Returns `null` for expired tokens, which causes `hasCachedSession()` to return `false`
3. **`Auth.tsx` (line 203-205)**: Uses `checkCachedSession()` (which calls `hasCachedSession`) -- when it returns false, shows "Sign in requires an internet connection" instead of the "Go to Dashboard" button

## Solution

When offline, token expiry should not block access. The token is only needed for server API calls, which aren't happening offline anyway. The user just needs access to their locally cached data.

### 1. Add offline-aware session check (`src/lib/cached-auth.ts`)

Add a new function `hasCachedSessionForOffline()` that checks if a cached session exists with valid user data, but ignores `expires_at` when offline. This keeps the strict check for online scenarios while allowing offline access.

```typescript
export function hasCachedSessionForOffline(): boolean {
  try {
    const cachedSession = localStorage.getItem('sb-ssgzcgvygnsrqalisshx-auth-token');
    if (!cachedSession) return false;
    const parsed = JSON.parse(cachedSession);
    // Only require a user identity exists -- don't check expiry for offline use
    return !!(parsed?.user?.id || parsed?.access_token);
  } catch {
    return false;
  }
}
```

### 2. Fix `Index.tsx` offline redirect

Remove the `expires_at` check from the offline branch. If the user is offline and has any cached session with an access token, navigate to the dashboard immediately.

### 3. Fix `Auth.tsx` offline banner and button

- Replace `checkCachedSession()` with `hasCachedSessionForOffline()` so the "Go to Dashboard" button appears even with an expired token
- Update the offline message to be more reassuring: "Tap below to access your cached reports"

### 4. Version bump (`vite.config.ts`)

Bump to v2.4.14.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/cached-auth.ts` | Add `hasCachedSessionForOffline()` function |
| `src/pages/Index.tsx` | Remove `expires_at` check in offline branch |
| `src/components/Auth.tsx` | Use `hasCachedSessionForOffline()` for offline "Go to Dashboard" button |
| `vite.config.ts` | Version bump to v2.4.14 |

