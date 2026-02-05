
# Plan: Fix Mobile PWA Sync Failure - Session Validation (v2.2.101)

## Problem Summary

Mobile PWA users are experiencing sync failures where new inspection records created on mobile don't appear on the web version. The database logs show RLS policy violations, indicating the JWT token used for database operations is invalid or expired.

## Root Cause

The sync manager uses `getUserWithCache()` which returns a cached user from localStorage. However, this does NOT guarantee the Supabase client has a valid JWT token. When the JWT expires:

1. `getUserWithCache()` returns the cached user (check passes)
2. `inspection.inspector_id === user.id` check passes
3. Supabase client makes request with expired/invalid JWT
4. RLS check fails because `auth.uid()` returns NULL
5. Error: "new row violates row-level security policy"

```text
Flow Diagram:

+-------------------+     +------------------+     +-------------------+
| getUserWithCache()|---->| Returns cached   |---->| inspector_id      |
| (localStorage)    |     | user from storage|     | check PASSES      |
+-------------------+     +------------------+     +-------------------+
                                                           |
                                                           v
+-------------------+     +------------------+     +-------------------+
| Supabase.upsert() |---->| Uses JWT from    |---->| JWT expired?      |
| (database call)   |     | client session   |     | auth.uid() = NULL |
+-------------------+     +------------------+     +-------------------+
                                                           |
                                                           v
                                                  +-------------------+
                                                  | RLS FAILS!        |
                                                  | "violates policy" |
                                                  +-------------------+
```

## Solution

Add session validation BEFORE database operations in the atomic sync manager. If the session is invalid, refresh it before proceeding.

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `src/lib/cached-auth.ts` | **Add function** | Add `ensureValidSession()` that validates and refreshes JWT if needed |
| `src/lib/atomic-sync-manager.ts` | **Modify** | Call `ensureValidSession()` before any database operations |
| `vite.config.ts` | **Modify** | Version bump to 2.2.101 |

---

## Implementation Details

### 1. Add Session Validation Function (cached-auth.ts)

Add a new function that ensures the Supabase client has a valid session before making database calls:

```typescript
/**
 * Ensures the Supabase client has a valid session before database operations.
 * This is critical for sync operations that rely on RLS policies.
 * 
 * Unlike getUserWithCache() which reads from localStorage, this actually
 * validates the session with the Supabase client and refreshes if needed.
 * 
 * @returns The current user if session is valid, null otherwise
 */
export async function ensureValidSession(): Promise<CachedUser | null> {
  try {
    // First, try to get the current session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('[CachedAuth] Session error:', sessionError);
      return null;
    }
    
    // If no session, user needs to log in
    if (!session) {
      console.warn('[CachedAuth] No active session');
      return null;
    }
    
    // Check if token needs refresh (within 60 seconds of expiry)
    const expiresAt = session.expires_at || 0;
    const now = Math.floor(Date.now() / 1000);
    const needsRefresh = expiresAt - now < 60;
    
    if (needsRefresh) {
      console.log('[CachedAuth] Session expiring soon, refreshing...');
      const { data: { session: refreshedSession }, error: refreshError } = 
        await supabase.auth.refreshSession();
      
      if (refreshError || !refreshedSession) {
        console.error('[CachedAuth] Failed to refresh session:', refreshError);
        return null;
      }
      
      // Update cache with refreshed user
      cachedUser = refreshedSession.user;
      cacheTimestamp = Date.now();
      return refreshedSession.user;
    }
    
    // Session is valid - update cache and return user
    cachedUser = session.user;
    cacheTimestamp = Date.now();
    return session.user;
    
  } catch (error) {
    console.error('[CachedAuth] Error validating session:', error);
    return null;
  }
}
```

### 2. Update Atomic Sync Manager

Modify `syncInspectionAtomic()` to validate the session before any database operations:

```typescript
// At the start of syncInspectionAtomic(), after the offline check:

// CRITICAL: Ensure we have a valid JWT before any database operations
// This prevents RLS failures due to expired tokens
const validUser = await ensureValidSession();
if (!validUser) {
  console.error('[Atomic Sync] No valid session - sync aborted');
  return { success: false, skipped: true, reason: 'invalid_session' };
}

// Use the validated user instead of cached user for ownership check
if (inspection.inspector_id !== validUser.id) {
  // ... existing ownership mismatch handling
}
```

Similarly update:
- `syncTrainingAtomic()`
- `syncDailyAssessmentAtomic()`
- `syncAllInspectionsAtomic()` (before the loop)
- `syncAllTrainingsAtomic()` (before the loop)  
- `syncAllDailyAssessmentsAtomic()` (before the loop)

### 3. Version Bump

Update version to **2.2.101** in `vite.config.ts`.

---

## Technical Details

### Why This Happens on Mobile More Often

1. **Background sync timing**: Mobile devices often have longer intervals between syncs
2. **App suspension**: iOS/Android suspend apps, sessions can expire while suspended
3. **Network transitions**: Moving between WiFi/cellular can cause session state issues
4. **PWA lifecycle**: Service workers and background sync have different session handling

### Session Expiry Flow

```text
T=0:    User logs in, JWT valid for 1 hour
T=45m:  User creates inspection offline
T=50m:  App goes to background (iOS suspends)
T=65m:  User returns, triggers sync
        - getUserWithCache() returns cached user (from localStorage)
        - JWT in Supabase client is EXPIRED
        - Database call fails with RLS error
```

### After Fix

```text
T=65m:  User returns, triggers sync
        - ensureValidSession() checks JWT expiry
        - Detects JWT expired, calls refreshSession()
        - Gets new valid JWT
        - Database call succeeds
```

---

## Testing Checklist

1. **Normal sync flow** - Create inspection on mobile, verify appears on web
2. **Expired session** - Wait 5+ minutes, sync should auto-refresh token
3. **Offline creation** - Create offline, come online, verify sync works
4. **Session refresh** - Verify refresh token flow works correctly
5. **Error handling** - If refresh fails, verify proper error message shown

---

## Rollback Plan

If issues arise, the change is isolated to session validation. Rollback by:
1. Removing `ensureValidSession()` calls in atomic-sync-manager.ts
2. Reverting to using `getUserWithCache()` directly
