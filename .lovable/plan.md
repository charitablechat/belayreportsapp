

# Fix: Syncing Lag and Persistent Spinning Indicator

## Root Causes Identified

### Issue 1: Stale Queued Operations Never Cleared (Primary Cause)
The console logs show **49 inspection queued operations, 31 training operations, and 6 assessment operations** accumulating in IndexedDB. These are read every sync cycle (every 30s on desktop) but **never cleaned up** because cleanup only runs when `anySuccess` is true (line 294 of `useAutoSync.tsx`). Since there are 0 unsynced items, no sync "succeeds," so the stale queue grows forever. Each cycle reads all 86 entries, causing unnecessary IndexedDB churn and the recurring 8s timeout warnings.

### Issue 2: Redundant IndexedDB Reads Per Cycle
Every 30-second sync cycle performs these reads even when `unsyncedCount === 0`:
- `getQueuedOperations()` (49 entries)
- `getQueuedTrainingOperations()` (31 entries)
- `getQueuedAssessmentOperations()` (6 entries)
- `getUnsyncedInspections()`, `getUnsyncedTrainings()`, `getUnsyncedDailyAssessments()`
- Full atomic sync pipeline for all 3 report types

This creates constant IndexedDB contention, triggering the `[Offline Storage] Operation timed out after 8000ms` warnings seen in the console.

### Issue 3: Sync Runs Even When Nothing to Sync
When `unsyncedCount === 0`, the sync still runs the full pipeline (soft-delete processing, 3 atomic syncs, photo sync), wasting resources and creating the perception of constant activity.

## Fix Plan

### Step 1: Clear stale queued operations independently of sync success
**File:** `src/hooks/useAutoSync.tsx`

Move the queue cleanup **outside** the `if (anySuccess)` gate. When there are 0 unsynced items but queued operations exist, clean them up unconditionally. This immediately eliminates the 86 stale entries and the associated IndexedDB churn.

```typescript
// BEFORE (line 294): cleanup only when anySuccess
if (anySuccess) { /* cleanup queued ops */ }

// AFTER: cleanup whenever sync completes (no unsynced items = stale queue)
if (!allFetchesFailed) {
  // Always clean stale queued ops (they accumulate when no items need syncing)
  (async () => { /* cleanup logic - moved outside anySuccess gate */ })();
  
  if (anySuccess) {
    // toast, notifications, emit sync complete, etc.
  }
}
```

### Step 2: Skip full sync pipeline when nothing to sync
**File:** `src/hooks/useAutoSync.tsx`

Add an early exit in `performSync` when `unsyncedCount === 0` AND there are no queued operations. This eliminates the 30-second cycle overhead entirely when there's nothing to do.

```typescript
// After session validation, before starting the pipeline:
if (unsyncedCountRef.current === 0) {
  // Still process queued soft-deletes and clean stale queued ops
  // but skip the full atomic sync + photo sync pipeline
}
```

### Step 3: Reduce periodic sync frequency when idle
**File:** `src/hooks/useAutoSync.tsx`

When there are 0 unsynced items and the last sync was successful, back off to a longer interval (e.g., 120s instead of 30s for desktop) to reduce background noise. Reset to normal interval when items appear.

## Files Changed
1. `src/hooks/useAutoSync.tsx` — stale queue cleanup, early exit on empty, adaptive interval

## Impact
- Eliminates the persistent 8s timeout warnings (no more unnecessary IndexedDB reads)
- Removes the spinning indicator caused by constant sync activity
- Reduces IndexedDB contention from ~6 transactions/cycle to near-zero when idle
- Preserves all existing sync guarantees when items actually need syncing

