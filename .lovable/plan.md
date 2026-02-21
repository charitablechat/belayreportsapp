

## Fix: Navigator LockManager Auth Token Timeout

### Root Cause

The Supabase JS client (v2.78+) uses the browser's `navigator.locks` API internally to serialize access to the auth session token. When the InspectionForm loads, it fires 6+ parallel database queries simultaneously (via `Promise.all`), plus background auto-sync and auth refresh operations are also competing for the same lock. This causes a deadlock where one operation holds the lock and others queue up, eventually timing out after 10 seconds with:

> "Acquiring an exclusive Navigator LockManager lock "lock:sb-...-auth-token" timed out waiting 10000ms"

This crashes the entire load flow because the error propagates up to the catch block, which shows "Failed to load inspection" and redirects to the dashboard.

### Solution (Two-Part Fix)

**Part 1: Increase the lock timeout in the Supabase client configuration**

The Supabase client supports a `lock.acquireTimeout` option (undocumented but present in auth-js). Since the auto-generated `client.ts` cannot be edited directly, we will create a **post-initialization configuration patch** that sets the lock timeout higher (e.g., 30 seconds) by calling `supabase.auth.setLockAcquireTimeout()` or by re-initializing with the option.

However, since `client.ts` is auto-generated and we cannot edit it, the practical fix is:

**Part 2: Make the InspectionForm load resilient to lock timeout errors**

Wrap the parallel Supabase queries in the `loadInspection` function so that a lock timeout error on any single query does not crash the entire load. The `withQueryTimeout` helper already exists -- we just need to ensure the LockManager error is caught and treated as a timeout (returning fallback data from offline cache) rather than a fatal error.

### Files to Change

**`src/pages/InspectionForm.tsx`**
- In the `loadInspection` function's main catch block (~line 1164), detect the LockManager timeout error specifically and gracefully fall back to offline-only data instead of navigating away to the dashboard. If offline data was already loaded earlier in the function, the user can still view and work with the report.

**`src/lib/cached-auth.ts`**
- In `ensureValidSession()` and `getUserWithCache()`, catch LockManager timeout errors specifically and fall back to the localStorage-cached session instead of returning null. This prevents the lock contention from cascading into a full auth failure.

### Detailed Changes

**`src/pages/InspectionForm.tsx` (catch block, ~line 1164)**
- Check if the error message contains "LockManager" or "lock" and "timed out"
- If offline data was already loaded (inspection state is populated), suppress the error toast and continue with cached data instead of redirecting
- Only redirect to dashboard if there is genuinely no data to show

**`src/lib/cached-auth.ts` (ensureValidSession, ~line 342)**
- Wrap the `supabase.auth.getSession()` call in a try-catch that specifically handles the LockManager error
- On LockManager failure, read the session directly from localStorage (the `sb-...-auth-token` key) and extract the user, bypassing the lock entirely
- This is safe because we only need the user ID for RLS -- the token in localStorage is the same one the lock was protecting

**`src/lib/cached-auth.ts` (getUserWithCache, ~line 125)**
- Same pattern: if `supabase.auth.getUser()` throws a LockManager error, fall back to the localStorage session user

### Why This Works

The LockManager error is a concurrency problem, not an authentication problem. The auth token in localStorage is still perfectly valid. By falling back to the cached session on lock contention, we avoid the cascading failure without compromising security. The user's session is still authenticated -- it's just that the lock serialization failed due to too many concurrent requests.
