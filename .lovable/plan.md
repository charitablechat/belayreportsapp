

## Bug: Save Button Missing on Inspection Form

### Root Cause

The Save button is present in the code but **conditionally hidden** by `{!effectiveReadOnly && (...)}`. The chain is:

1. `effectiveReadOnly = isReadOnly || isCompletionLocked`
2. `isReadOnly` comes from `useReportEditPermission`
3. The hook returns `isReadOnly: true` when `currentUserId` is `null` (the "still loading" fallback at line 110)
4. Console logs confirm: **"Session validation timed out, skipping sync"** -- the auth session is timing out

When `getUserWithCache()` times out or the session cache expires, `currentUserId` stays `null`. Even though `inspectorId` is loaded from IndexedDB, the permission hook can't confirm ownership, so it defaults to read-only mode. This hides the Save and Complete buttons entirely.

### Why This Wasn't Caught Before

The auth timeout is intermittent. It depends on network conditions, Supabase session state, and LockManager availability. When auth resolves quickly, the Save button appears normally.

### Fix

Modify `useReportEditPermission` to use `getOfflineUserId()` as an immediate synchronous fallback when the async auth check hasn't completed yet. This ensures `currentUserId` is populated from localStorage before the network auth resolves, preventing the "loading = read-only" state from hiding buttons.

### Code Changes

**File: `src/hooks/useReportEditPermission.tsx`**

In the `useEffect` that calls `checkPermissions`, initialize `currentUserId` from localStorage **synchronously before** the async auth check:

```typescript
useEffect(() => {
  // Synchronous fast-path: set userId from localStorage immediately
  // so effectiveReadOnly is false while async auth resolves
  const offlineId = getOfflineUserId();
  if (offlineId && !currentUserId) {
    setCurrentUserId(offlineId);
  }

  const checkPermissions = async () => {
    // ... existing async logic unchanged
  };

  checkPermissions();
  // ... rest unchanged
}, []);
```

This ensures:
- The Save button is visible immediately (no flash of read-only state)
- If the async auth check returns a different userId (shouldn't happen), it overwrites correctly
- If auth times out entirely, the localStorage fallback keeps the UI functional
- No changes to any other file or component

### Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useReportEditPermission.tsx` | Add synchronous `getOfflineUserId()` call at start of useEffect |

### What This Does NOT Change

- No changes to the Save button itself or its position in the header
- No changes to InspectionForm, TrainingForm, or DailyAssessmentForm
- No changes to the auth system or cached-auth logic
- No changes to IndexedDB, sync, or data persistence

