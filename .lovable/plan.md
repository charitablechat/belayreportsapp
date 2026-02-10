

# Harden Offline-First Data Persistence and Authentication

## Current State

The application already has a substantial offline infrastructure:
- **IndexedDB** with 20+ object stores for all report types and child data (v6 schema in `offline-storage.ts`)
- **Offline sign-in** via synthetic sessions (`offline-auth.ts`) -- just implemented
- **Background sync** with atomic batch processing, accelerated re-sync, and LWW conflict resolution (`useAutoSync`, `atomic-sync-manager.ts`)
- **Deferred credential verification** with userId migration on reconnect

However, there are **three critical gaps** that would break the offline experience on mobile devices:

## Gap 1: Expired Real Sessions Block Dashboard Offline

**Problem:** `getCachedUserFromStorage()` in `cached-auth.ts` (line 239) rejects tokens where `expires_at` has passed. If a user logs in online, goes offline, and their JWT expires (typically 1 hour), `getUserWithCache()` returns `null`. The Dashboard then has no `userId` and cannot load any IndexedDB data.

The `hasCachedSessionForOffline()` function correctly ignores expiry, but `getCachedUserFromStorage()` does not. Since the Dashboard and all forms use `getUserWithCache()` (which calls `getCachedUserFromStorage()`), expired sessions silently break offline data access.

**Fix:** Make `getCachedUserFromStorage()` skip expiry checks when offline, matching the behavior of `hasCachedSessionForOffline()`.

| File | Change |
|------|--------|
| `src/lib/cached-auth.ts` | In `getCachedUserFromStorage()`, skip the `expires_at` check when `!navigator.onLine` |

## Gap 2: Dashboard Auth Listener Ejects Offline Users

**Problem:** Dashboard line 232: `if (event === 'SIGNED_OUT' || !session)` redirects to login. When the Supabase client initializes with a synthetic session (fake JWT `offline_placeholder_token`), it may emit `TOKEN_REFRESHED` failure or `SIGNED_OUT` events because the token is not a valid JWT. This would kick the user out of the Dashboard while offline.

**Fix:** Guard the redirect so it only fires when the user is online or explicitly signs out.

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Add `navigator.onLine` check before redirecting on auth state change. Only redirect on explicit `SIGNED_OUT` events, not on missing sessions while offline. |

## Gap 3: Form Pages Lack Offline Auth Guards

**Problem:** `InspectionForm.tsx`, `TrainingForm.tsx`, and `DailyAssessmentForm.tsx` fetch the current user on load. If `getUserWithCache()` returns null while offline (e.g., due to gap 1 before the fix), these forms fail silently or show errors instead of loading existing offline data.

**Fix:** Add defensive offline guards to form page load sequences -- if offline and no user found, attempt to read userId from the synthetic session in localStorage as a fallback.

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Add offline fallback for userId resolution |
| `src/pages/TrainingForm.tsx` | Add offline fallback for userId resolution |
| `src/pages/DailyAssessmentForm.tsx` | Add offline fallback for userId resolution |

## Implementation Details

### 1. `src/lib/cached-auth.ts` -- Skip expiry when offline

```typescript
// In getCachedUserFromStorage(), change:
if (!expiresAt || expiresAt * 1000 <= Date.now()) {
  return null;
}
// To:
if (!navigator.onLine) {
  // Offline: ignore token expiry -- we only need user identity for IndexedDB filtering
} else if (!expiresAt || expiresAt * 1000 <= Date.now()) {
  return null;
}
```

### 2. `src/pages/Dashboard.tsx` -- Guard auth state redirect

```typescript
// Change the auth state change handler:
supabase.auth.onAuthStateChange((event, session) => {
  // Only update currentUser from real auth events, not synthetic session failures
  if (session?.user) {
    setCurrentUser(session.user);
  }
  
  // Only redirect on explicit sign-out while online
  // Offline synthetic sessions may trigger false SIGNED_OUT events
  if (event === 'SIGNED_OUT' && navigator.onLine) {
    navigate("/", { replace: true });
  }
});
```

### 3. Form pages -- Offline userId fallback utility

Create a small shared utility in `cached-auth.ts`:

```typescript
export function getOfflineUserId(): string | null {
  try {
    const session = localStorage.getItem('sb-ssgzcgvygnsrqalisshx-auth-token');
    if (!session) return null;
    const parsed = JSON.parse(session);
    return parsed?.user?.id || null;
  } catch {
    return null;
  }
}
```

Then in each form page's user check:
```typescript
const user = await getUserWithCache();
const userId = user?.id || getOfflineUserId();
if (!userId) {
  // Truly no identity available
  ...
}
```

## Synchronization Architecture Summary

For reference, the complete offline data flow uses:

- **Local Storage Technology:** IndexedDB via the `idb` library (v8), with a dedicated `rope-works-inspections` database (v6) containing 20+ object stores for all report types and child data
- **Operation Queue:** Three operation stores (`operations`, `assessment_operations`, `training_operations`) with auto-incrementing keys, retry counters, and timestamps
- **Conflict Resolution:** Silent Last-Write-Wins (LWW) comparing `updated_at` timestamps between local and remote records
- **Sync Trigger Points:** Debounced (3s after edits), immediate (on reconnect), periodic (30s desktop / 60s mobile), visibility change, and iOS pageshow/focus events
- **Batch Processing:** Maximum 5 items per sync cycle with accelerated 5s re-sync for remaining items
- **Circuit Breaker:** Disables IndexedDB for 60s after 3 consecutive timeout failures (2s threshold)
- **Auth Reconciliation:** On reconnect, `verifyAndReconcileOfflineAuth()` runs before sync to validate credentials and migrate userId if needed

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `src/lib/cached-auth.ts` | Modify | Skip token expiry when offline; add `getOfflineUserId()` utility |
| `src/pages/Dashboard.tsx` | Modify | Guard auth state redirect to prevent ejecting offline users |
| `src/pages/InspectionForm.tsx` | Modify | Add offline userId fallback |
| `src/pages/TrainingForm.tsx` | Modify | Add offline userId fallback |
| `src/pages/DailyAssessmentForm.tsx` | Modify | Add offline userId fallback |

## What Does NOT Change

- IndexedDB schema and offline-storage.ts (already complete)
- offline-auth.ts (just implemented, no changes needed)
- useAutoSync.tsx (already handles offline auth verification)
- atomic-sync-manager.ts (unchanged)
- UserProfileDropdown component (no dependency on auth flow)
- Dashboard layout and sync status strip spacing (unchanged)
- goBack(navigate) navigation logic (unchanged)

