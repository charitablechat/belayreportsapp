

# Fix: Buttons Disappearing When Device Goes Offline

## Root Cause

When the device transitions to offline (or stays offline long enough for the auth cache to expire), the following chain causes buttons to vanish:

1. `getUserWithCache()` returns `null` when offline and no cached user exists in localStorage (auth cache TTL is 1 minute)
2. `useReportEditPermission` sets `currentUserId = null`
3. The permission hook's fallback path (lines 99-108) returns `isReadOnly: true` when `currentUserId` is null
4. `effectiveReadOnly = isReadOnly || isCompletionLocked` becomes `true`
5. All UI elements gated by `{!effectiveReadOnly && ...}` are hidden -- Save button, PhotoCapture (Take Photo / Upload), and Complete button

The `getOfflineUserId()` fallback on line 49 of the hook only runs once during initial mount. If the user object later becomes null due to cache expiry while offline, the `currentUserId` state is overwritten to `null`.

## Fix Strategy

### 1. Harden `useReportEditPermission` against offline auth loss (primary fix)

**File:** `src/hooks/useReportEditPermission.tsx`

- In the `checkPermissions` function, ensure that if `getUserWithCache()` returns null, the hook always falls back to `getOfflineUserId()` before setting `currentUserId`
- Store the resolved userId in a ref so that subsequent auth state changes that yield null (common when offline) do not overwrite a previously known good userId
- Add a guard in the `onAuthStateChange` callback: if `session` is null but `navigator.onLine` is false, retain the current userId instead of clearing it

```text
Before (line 49):
  const userId = user?.id ?? getOfflineUserId();

After:
  const userId = user?.id ?? getOfflineUserId();
  // Only update if we actually got a userId - don't clear a known-good ID
  if (userId) {
    setCurrentUserId(userId);
  }
  // (remove the unconditional setCurrentUserId below)
```

For the auth state change listener:
```text
Before (line 69):
  setCurrentUserId(session?.user?.id ?? null);

After:
  const newUserId = session?.user?.id;
  if (newUserId) {
    setCurrentUserId(newUserId);
  } else if (navigator.onLine) {
    // Only clear userId on explicit sign-out while online
    setCurrentUserId(null);
  }
  // If offline and session is null, retain existing userId
```

### 2. Prevent `getUserWithCache` from returning null when offline with valid localStorage data

**File:** `src/lib/cached-auth.ts`

The function already checks localStorage on line 64, but if the stored data has been cleared or corrupted, it falls through to the offline null-return on line 86-88. Add a final fallback using `getOfflineUserId()`:

```text
Before (lines 85-88):
  if (!navigator.onLine) {
    return null;
  }

After:
  if (!navigator.onLine) {
    // Last resort: construct minimal user object from offline ID
    const offlineId = getOfflineUserId();
    if (offlineId) {
      const fallbackUser = { id: offlineId };
      cachedUser = fallbackUser;
      cacheTimestamp = Date.now();
      return fallbackUser;
    }
    return null;
  }
```

## What This Fixes

- **Save button**: Gated by `!effectiveReadOnly` -- will now remain visible offline since `isReadOnly` stays false for report owners
- **Take Photo / Upload buttons**: `PhotoCapture` is rendered conditionally via `{!effectiveReadOnly && <PhotoCapture ...>}` -- same fix
- **Complete button**: Already correctly disabled (not hidden) when offline via `disabled={!isOnline}`, so it will remain visible but non-functional -- no change needed

## What Remains Unchanged

- All RLS policies and data loss prevention protocols
- The local-first save architecture (IndexedDB writes work offline)
- Photo capture's local-first flow (saves to IndexedDB, syncs later)
- Completion lock and field interception logic
- Auto-save debounce and interval patterns

## Files Modified

1. `src/hooks/useReportEditPermission.tsx` -- Harden against null userId when offline
2. `src/lib/cached-auth.ts` -- Add offline fallback user construction

