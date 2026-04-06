

# Fix "User not authenticated" Error on Inspection Form Save

## Root Cause

The `performSave` function in `InspectionForm.tsx` (line 1336) uses `getUserWithCache()` to check auth. This function:
1. Returns cached user if in-memory cache is fresh (< 60s)
2. Falls back to localStorage session — but **rejects expired tokens when online**
3. Falls back to network `getUser()` with an 8s timeout

If the session token has expired and the network call is slow or fails, `getUserWithCache()` returns `null`. The code then checks `getOfflineUserId()` but only when `!navigator.onLine` — so an online user with an expired token gets `'User not authenticated'`.

Meanwhile, `ensureValidSession()` exists specifically to handle this: it calls `supabase.auth.refreshSession()` to get a fresh token. But `performSave` never calls it.

## Fix

In `performSave`, replace the current auth check with a cascade that tries `ensureValidSession()` before giving up:

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | In `performSave` (~line 1336), after `getUserWithCache()` returns null while online, attempt `ensureValidSession()` before throwing. This refreshes the token and recovers the session. |

### Current code (lines 1335-1343):
```typescript
let user = await getUserWithCache();
if (!user && !navigator.onLine) {
  const offlineId = getOfflineUserId();
  if (offlineId) user = { id: offlineId } as any;
}
if (!user) {
  throw new Error('User not authenticated');
}
```

### Fixed code:
```typescript
let user = await getUserWithCache();
if (!user && !navigator.onLine) {
  const offlineId = getOfflineUserId();
  if (offlineId) user = { id: offlineId } as any;
}
if (!user && navigator.onLine) {
  // Token may have expired — attempt session refresh before giving up
  user = await ensureValidSession();
}
if (!user) {
  throw new Error('User not authenticated');
}
```

This adds one extra recovery step. If the token expired but the refresh token is still valid (which it is for 30+ days), `ensureValidSession()` will refresh the session and return the user. The error will only appear if the user is genuinely signed out.

The `ensureValidSession` import already exists in other files but needs to be added to `InspectionForm.tsx`'s import from `cached-auth`.

