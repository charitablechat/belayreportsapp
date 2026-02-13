

# Fix: "Pro Tour" Report Lost During Offline-to-Online Sync

## Root Cause: Race Condition Between Sync and Orphan Cleanup

When a report is created offline (with a `temp-` ID) and the device reconnects, **two processes run simultaneously**:

1. **Auto-sync** (`useAutoSync.handleOnline`): Transforms `temp-` ID to a real UUID, upserts to the server
2. **Dashboard reload** (`handleOnline` + `onSyncComplete`): Fetches server data, then runs orphan cleanup

The orphan cleanup deletes any local record whose ID is NOT on the server AND does NOT start with `temp-`. The problem:

- Step A: Sync renames `temp-ProTour` to `uuid-ProTour` in IndexedDB (temp- prefix removed)
- Step B: Sync starts uploading `uuid-ProTour` to the server (takes seconds)
- Step C: Dashboard fetches server data (server doesn't have `uuid-ProTour` yet)
- Step D: Orphan cleanup sees `uuid-ProTour` locally, not on server, not `temp-` prefixed -- **deletes it**

The upload in Step B finishes, but the local copy is already gone. On next page load, there is nothing left.

## Immediate Fix

### 1. Dashboard.tsx -- Add "recently synced" guard to orphan cleanup (3 locations)

Before deleting an orphan, check if the record was recently synced (within the last 60 seconds). A record that just had its ID transformed by the sync pipeline will have a very recent `updated_at` but no `synced_at` yet -- or a `synced_at` that is very recent. Either way, skipping recent records prevents the race.

**For all three orphan cleanup blocks** (inspections at ~line 401, trainings at ~line 504, assessments at ~line 606):

Before:
```typescript
if (!serverIds.has(local.id) && !local.id.startsWith('temp-')) {
  await deleteOfflineInspection(local.id);
}
```

After:
```typescript
if (!serverIds.has(local.id) && !local.id.startsWith('temp-')) {
  // SAFETY: Skip records that were recently created or synced
  // They may be in-flight (temp-to-UUID transform completed, server upload pending)
  const updatedAt = local.updated_at ? new Date(local.updated_at).getTime() : 0;
  const isRecentlyModified = (Date.now() - updatedAt) < 60000; // 60 seconds
  if (isRecentlyModified) {
    console.log('[Dashboard] Skipping orphan cleanup for recently modified record:', local.id);
    continue;
  }
  await deleteOfflineInspection(local.id);
}
```

This applies identically to the training and daily assessment orphan cleanup blocks, using their respective delete functions.

### 2. atomic-sync-manager.ts -- Delay old temp-ID deletion until AFTER server commit

Currently, the sync pipeline deletes the old `temp-` IndexedDB entry and re-saves under the new UUID. But the `emitSyncComplete()` event fires immediately after, triggering a Dashboard reload before the server has fully committed.

Move the `emitSyncComplete` call timing: this is already handled by `useAutoSync` (line 240), so no change needed in atomic-sync-manager. The fix is entirely in the Dashboard orphan guard above.

## Verification Strategy

1. **Offline creation test**:
   - Disconnect from network
   - Create a new inspection report (e.g., "Test Pro Tour")
   - Verify it appears in the dashboard with a `temp-` ID
   - Reconnect to network
   - Wait 10 seconds for sync to complete
   - Verify the report persists on the dashboard with a real UUID
   - Refresh the page -- report should still be there

2. **Multi-tab race test**:
   - Create an offline report
   - Open a second browser tab on the dashboard
   - Reconnect to network
   - Verify both tabs show the report after sync

3. **Repeat for all report types**: Training reports, Daily Assessments

## Preventative Measure

Add a `created_at` check as a permanent safety net: never orphan-delete any record created within the last 5 minutes, regardless of server state. This protects against any future race conditions in the sync pipeline.

## Files Changed

1. **src/pages/Dashboard.tsx** -- Add recently-modified guard to all 3 orphan cleanup blocks (inspections, trainings, daily assessments)

No database changes required. No changes to the sync pipeline itself.

