

# Fix: Sync Lagging Due to Session Validation Timeouts

## Root Cause

The console logs show the same message repeating on every sync cycle:
```
[AutoSync] Session validation timed out, skipping sync
```

The flow is:
1. `useAutoSync` calls `ensureValidSession()` with a 5-second timeout
2. `ensureValidSession()` **always** calls `supabase.auth.getSession()` — even when a perfectly valid, non-expired token exists in localStorage
3. `getSession()` uses the browser's LockManager internally, which can hang under contention (multiple tabs, service worker, concurrent auth calls)
4. The 5s timeout fires → sync is skipped → next cycle tries again → same hang → **sync never completes**

The irony: `getUserWithCache()` (used elsewhere) has a fast localStorage path that avoids this exact problem, but `ensureValidSession()` was written to always validate via the Supabase client.

## Fix

**Add a localStorage fast-path to `ensureValidSession()`** — if the token exists and isn't near expiry, return the user immediately without calling `supabase.auth.getSession()`. Only do the full network/lock validation when the token is close to expiring.

### File: `src/lib/cached-auth.ts` — `ensureValidSession()`

Replace the current logic (lines 444-541) with:

```typescript
export async function ensureValidSession(): Promise<CachedUser | null> {
  initAuthListener();
  
  try {
    // FAST PATH: Check localStorage first — avoid LockManager entirely
    // if we have a token that isn't near expiry
    const storedSession = localStorage.getItem('sb-ssgzcgvygnsrqalisshx-auth-token');
    if (storedSession) {
      const parsed = JSON.parse(storedSession);
      const expiresAt = parsed?.expires_at || 0;
      const now = Math.floor(Date.now() / 1000);
      const timeUntilExpiry = expiresAt - now;
      
      // If token is valid and not within 5-min refresh buffer, skip network call
      if (parsed?.user && timeUntilExpiry > SESSION_REFRESH_BUFFER) {
        cachedUser = parsed.user;
        cacheTimestamp = Date.now();
        return parsed.user;
      }
      
      // Token near expiry but user exists — return user, refresh in background
      if (parsed?.user && timeUntilExpiry > 0) {
        cachedUser = parsed.user;
        cacheTimestamp = Date.now();
        // Non-blocking refresh
        if (navigator.onLine) {
          setTimeout(() => {
            supabase.auth.refreshSession().catch(() => {});
          }, 0);
        }
        return parsed.user;
      }
    }
    
    // SLOW PATH: No valid localStorage token — must use Supabase client
    // (existing getSession + refresh logic, with LockManager fallback)
    // ... keep existing slow-path code ...
  }
}
```

### File: `src/hooks/useAutoSync.tsx` — lines 146-148

Increase the timeout from 5s to 8s as a safety net (though with the fast path, it should rarely be hit):

```typescript
new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 8000))
```

### File: `src/lib/atomic-sync-manager.ts`

Apply the same timeout increase (5s → 8s) to the three session validation timeouts in the atomic sync functions (lines ~727, ~1504, ~2210) for consistency.

## Why This Fixes It

- **Before**: Every sync cycle → `getSession()` → LockManager contention → 5s timeout → sync skipped
- **After**: Every sync cycle → localStorage check (< 1ms) → valid token found → sync proceeds immediately
- The Supabase client is only consulted when the token is genuinely near expiry (within 5 minutes), which happens at most once every ~55 minutes

## Files Changed
1. `src/lib/cached-auth.ts` — add localStorage fast-path to `ensureValidSession()`
2. `src/hooks/useAutoSync.tsx` — increase fallback timeout
3. `src/lib/atomic-sync-manager.ts` — increase fallback timeouts (3 locations)

