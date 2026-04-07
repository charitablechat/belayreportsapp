

# Fix: Ensure All Deleted Reports Appear in Admin Data Recovery "Deleted" Tab

## Root Cause Analysis

**Two distinct issues cause deleted reports to not appear in the Deleted tab:**

### Issue 1: Offline soft-deletes are queued but never processed (PRIMARY)
When a user deletes a report while offline, Dashboard.tsx calls `queueOperation('update', id, softDeleteData)` to queue the soft-delete. However, **no code ever processes these queued operations**. The atomic sync manager (`atomic-sync-manager.ts`) only syncs records from the main IndexedDB stores — it does not consume the `operations`, `assessment_operations`, or `training_operations` queues.

Result: The offline-deleted report's local copy is removed (so it disappears from the user's dashboard), but the server record is never updated with `deleted_at`. It silently reappears on next sync and never shows in the Deleted tab.

### Issue 2: No error feedback or audit trail for failed deletions
The Dashboard deletion flow has a single `catch` block that shows a generic "Failed to delete report" toast. There is no logging of which specific step failed (offline removal vs. server update vs. queue), making it impossible to diagnose partial failures.

## Proposed Changes

### 1. Process queued soft-delete operations on reconnect (`src/hooks/useAutoSync.tsx`)
Add a `processQueuedSoftDeletes()` function that runs at the beginning of each sync cycle (before the atomic sync). It will:
- Read all three operation queues (`operations`, `assessment_operations`, `training_operations`)
- Filter for entries where `data.deleted_at` is set (soft-delete operations)
- Apply each as a targeted UPDATE to the server (setting `deleted_at`, `deleted_by`, `retention_until`)
- Remove successfully processed entries from the queue
- Log failures without blocking the rest of the sync

### 2. Create a reusable queue processor (`src/lib/queued-soft-delete-processor.ts`)
New file with:
- `processQueuedSoftDeletes()`: Reads all three queues, filters for soft-delete ops, applies them to the server, removes from queue on success
- Handles each table type (`inspections`, `trainings`, `daily_assessments`) with the correct queue getter/remover
- Returns a summary: `{ processed: number, failed: number, errors: string[] }`

### 3. Enhance Dashboard deletion error handling (`src/pages/Dashboard.tsx`)
- Add structured logging: `console.error('[Dashboard] Soft-delete failed at step:', { step, table, id, error })`
- When online deletion fails, show the specific error in the toast instead of generic message
- When the server UPDATE succeeds but offline storage cleanup fails, still count it as a success (the record IS soft-deleted)
- Add a fallback: if the server update throws an RLS error, log and suggest the user try again when properly authenticated

### 4. Add a "Queued Deletions" indicator in the Deleted tab (`src/components/admin/DeletedRecordsRecovery.tsx`)
- On load, check all three operation queues for pending soft-delete operations
- If any exist, show an info banner: "X deletions are pending sync. They will appear here once the device reconnects."
- This gives admins visibility into the gap

## Files Modified
1. **`src/lib/queued-soft-delete-processor.ts`** — New file, queue processing logic
2. **`src/hooks/useAutoSync.tsx`** — Call processor at start of sync cycle
3. **`src/pages/Dashboard.tsx`** — Better error handling and logging in `handleDeleteConfirm`
4. **`src/components/admin/DeletedRecordsRecovery.tsx`** — Pending deletions banner

## Result
- Offline soft-deletes will reliably sync to the server on reconnect
- All deleted reports will appear in the Deleted tab after sync
- Admins get visibility into pending offline deletions
- Failed deletions produce actionable error messages instead of silent failures

