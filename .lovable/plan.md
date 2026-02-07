
# Fix: Mobile Stuck on "Syncing 21 Reports"

## Root Cause

Three issues combine to create a sync loop on mobile:

### Issue 1: Dashboard fix not yet active on mobile
The `synced_at` stamping fix we just deployed only runs when the Dashboard loads fresh server data. The mobile app's IndexedDB still has records cached BEFORE the fix, all with `synced_at: NULL`. Every one of these appears as "unsynced" to `getUnsyncedInspections`.

### Issue 2: Sync-then-save race condition
When `syncInspectionAtomic` succeeds (line 380-384), it does:
```text
saveInspectionOffline({
  ...inspection,         // spreads the ORIGINAL inspection (with its updated_at)
  synced_at: new Date().toISOString(),  // sets synced_at to NOW
})
```
But `synced_at` and `updated_at` are set to the same millisecond-precision ISO string. On the next unsynced check, the string comparison `updated_at > synced_at` can evaluate to `true` if `updated_at` was set even 1ms later during a concurrent auto-save, causing the item to immediately re-enter the queue.

### Issue 3: Orphaned local records
The server has 19 active reports, but mobile has 21 in IndexedDB. The 2 extras are likely soft-deleted records that still exist locally. They fail every sync attempt because the server rejects them (RLS or soft-delete detection), but they never get removed from IndexedDB.

## Fix Implementation

### Fix A: Ensure `synced_at` always wins after successful sync
**File: `src/lib/atomic-sync-manager.ts`**

In `syncInspectionAtomic` (line 380), after a successful server transaction, set `synced_at` to be definitively AFTER `updated_at`:

```text
const syncTimestamp = new Date().toISOString();
await saveInspectionOffline({
  ...inspection,
  synced_at: syncTimestamp,
  updated_at: syncTimestamp,  // <-- Align both timestamps to prevent re-queuing
  inspector: inspectorProfile || { ... },
});
```

Apply the same pattern in `syncTrainingAtomic` and `syncDailyAssessmentAtomic`.

This is safe because the server already has the correct `updated_at` from the upsert. The local copy just needs to know "this version is synced."

### Fix B: Handle sync failures that return `skipped` with `remote_deleted` reason
**File: `src/lib/atomic-sync-manager.ts`**

The existing code already calls `deleteOfflineInspection` when a record is detected as soft-deleted (line 183). However, the item is marked as `skipped` (line 519) and doesn't increment `failCount`, so it silently persists if the deletion itself fails. Add a fallback: if the record's remote status check fails entirely (network error), mark the item with `synced_at = updated_at` to stop it from re-queuing.

### Fix C: One-time stale cache reconciliation on Dashboard load
**File: `src/pages/Dashboard.tsx`**

After loading server data and saving to IndexedDB (where we already stamp `synced_at`), add a cleanup step that removes any local records NOT present in the server response. This handles the orphaned 2 records:

```text
// After batch saving server data to IndexedDB:
const serverIds = new Set(networkData.map(i => i.id));
const localInspections = await getOfflineInspections(userId);
for (const local of localInspections) {
  if (!serverIds.has(local.id)) {
    await deleteOfflineInspection(local.id);
  }
}
```

Apply to all three report types.

**Important caveat**: Only run this cleanup when the server fetch succeeded (not on timeout/error), and only for the current user's records.

## Files to Modify

1. **`src/lib/atomic-sync-manager.ts`** -- Align `updated_at = synced_at` after successful sync in all three atomic sync functions (inspections, trainings, assessments)
2. **`src/pages/Dashboard.tsx`** -- Add orphan cleanup after successful server data load for all three report types

## Verification Plan

1. After deploying, force-refresh the mobile app (close and reopen, or pull-to-refresh)
2. The Dashboard load will: (a) stamp all server records with `synced_at`, (b) delete the 2 orphaned records
3. The pending count should drop from 21 to 0 within one sync cycle
4. Subsequent edits should sync and stay synced (no re-queuing)
