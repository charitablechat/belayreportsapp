

# Additional Hardening: Prevent Offline Report Data Loss

## Context

The "Pro Tour" report was lost this morning due to the race condition between sync and orphan cleanup. The 60-second recency guard we just deployed fixes the primary vector. This plan adds **defense-in-depth** to ensure no other path can cause this.

## What Happened to "Pro Tour"

1. Report created offline with a `temp-` ID
2. Device reconnected -- sync renamed `temp-XXX` to a real UUID in IndexedDB
3. Dashboard simultaneously fetched server data (server didn't have the report yet)
4. Orphan cleanup deleted the local UUID copy because it wasn't on the server and wasn't `temp-` prefixed
5. Server never received the data -- report is **not recoverable**

The fix deployed moments ago (60-second recency guard) prevents this exact scenario going forward.

## Additional Hardening (3 measures)

### 1. Add "sync-in-progress" flag to prevent orphan cleanup during active sync

The recency guard is timestamp-based and works well, but a belt-and-suspenders approach adds a global flag that the sync pipeline sets before starting and clears when done. Dashboard orphan cleanup checks this flag and skips cleanup entirely if sync is active.

**File: `src/lib/sync-events.ts`** -- Add `isSyncInProgress()` / `setSyncInProgress()` exports

**File: `src/pages/Dashboard.tsx`** -- Before each orphan cleanup loop, check:
```typescript
if (isSyncInProgress()) {
  console.log('[Dashboard] Sync in progress -- skipping orphan cleanup');
  // skip entire cleanup block
}
```

**File: `src/hooks/useAutoSync.tsx`** -- Wrap `performSync` with `setSyncInProgress(true/false)`

### 2. Extend recency window from 60 seconds to 5 minutes for created_at

The current guard uses `Math.max(updated_at, created_at)` with a 60-second window. For reports created offline (which may sit for hours before reconnecting), the `created_at` could be old. But `updated_at` gets refreshed during the temp-to-UUID transform, so 60s is sufficient for that.

However, as an extra safety net, add a dedicated check: never delete any record whose `created_at` is within the last 5 minutes, regardless of `updated_at`. This protects against edge cases where the sync pipeline doesn't update `updated_at`.

**File: `src/pages/Dashboard.tsx`** -- Enhance the guard in all 3 cleanup blocks:
```typescript
const createdAt = local.created_at ? new Date(local.created_at).getTime() : 0;
const isRecentlyCreated = (Date.now() - createdAt) < 300000; // 5 minutes
if (isRecentlyModified || isRecentlyCreated) {
  console.log('[Dashboard] Skipping orphan cleanup for recent record:', local.id);
  continue;
}
```

### 3. Log deleted orphans to a recovery array (last resort)

Before deleting an orphan, snapshot the full record into a `deletedOrphans` array stored in localStorage (capped at 20 entries). This provides a last-resort recovery path if the guards ever fail again.

**File: `src/pages/Dashboard.tsx`** -- Before each `deleteOffline*` call:
```typescript
try {
  const orphanLog = JSON.parse(localStorage.getItem('deletedOrphans') || '[]');
  orphanLog.push({ ...local, deletedAt: new Date().toISOString(), type: 'inspection' });
  if (orphanLog.length > 20) orphanLog.shift();
  localStorage.setItem('deletedOrphans', JSON.stringify(orphanLog));
} catch {}
```

## Files Changed

1. **src/lib/sync-events.ts** -- Add sync-in-progress flag
2. **src/hooks/useAutoSync.tsx** -- Set/clear sync-in-progress flag around performSync
3. **src/pages/Dashboard.tsx** -- Add sync-in-progress check, extend created_at guard to 5 minutes, add orphan deletion logging

## Verification Strategy

1. Create a report offline, reconnect, and confirm it persists on the dashboard
2. Verify the console shows "Skipping orphan cleanup" log messages during sync
3. Check localStorage for `deletedOrphans` key to confirm the safety net is in place
4. Repeat for all three report types (Inspection, Training, Daily Assessment)

