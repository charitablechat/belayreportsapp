

# Fix: Orphaned Training Operations Queue + iOS Sync Reliability

## Problem
Two issues identified:

1. **Orphaned `training_operations` queue entries**: When a training is saved or updated, a `queueTrainingOperation('update', ...)` call adds entries to the `training_operations` IndexedDB store. The `processQueuedSoftDeletes` processor only handles entries with `deleted_at` — regular `create`/`update` entries are never cleaned up and accumulate forever. This causes misleading "Queued training operations: 2" log messages every sync cycle.

2. **Brenda's reports are on her device only**: The reports visible in the screenshot exist only in her browser's IndexedDB and were never uploaded. The database has no record of them. This is consistent with iOS Safari sync failures (session expiry, bfcache issues, or the app being closed before sync completes).

## Changes

### 1. Clean up non-soft-delete queued operations after successful atomic sync
**File**: `src/lib/atomic-sync-manager.ts` (in `syncTrainingAtomic`)

After a training syncs successfully, remove matching entries from the `training_operations` queue. Currently only the `trainings` IndexedDB store entry is cleaned up (via `deleteOfflineTraining`), but the parallel `training_operations` entries are orphaned.

Add a cleanup step at the end of `syncTrainingAtomic` that:
- Reads all `training_operations` entries matching the synced `trainingId`
- Removes them via `removeQueuedTrainingOperation`

### 2. Process non-soft-delete queued operations in the sync cycle
**File**: `src/lib/queued-soft-delete-processor.ts`

Expand the processor to also clean up stale `create`/`update` entries (non-soft-delete) that have already been synced. After processing soft-deletes, check if the corresponding report exists in the `trainings` store with a valid `synced_at` — if so, remove the queued operation as it's already handled.

### 3. Add a post-sync queue cleanup sweep
**File**: `src/hooks/useAutoSync.tsx`

After the training atomic sync completes successfully, call `clearAllQueuedTrainingOperations()` to flush the queue. Since the atomic sync handles the actual data upload from the `trainings` store, the `training_operations` queue is redundant for non-soft-delete operations and can be safely cleared after a full successful sync cycle.

This is the simplest and safest approach — a single `clearAllQueuedTrainingOperations()` call after `syncAllTrainingsAtomic` succeeds.

## Impact
- Eliminates the "Queued training operations: 2" log noise
- Prevents indefinite IndexedDB storage accumulation
- Does not affect Brenda's device (her reports need to sync from her browser — advise her to open the app on a stable Wi-Fi connection)

## What won't change
Brenda's specific unsynced reports require action on **her device** — opening the app while online so the auto-sync can push them. No server-side fix can retrieve data that only exists in her browser's IndexedDB.

