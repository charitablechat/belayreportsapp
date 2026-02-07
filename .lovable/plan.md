
# Root Cause Analysis: Cross-Device Sync Count Divergence (22 vs 1)

## RCA Summary

The pending sync count is **per-device**, not cross-device. This is by design -- each device maintains its own IndexedDB, and the "unsynced count" reflects `locally modified records that haven't been pushed to the server from THIS device`. Device A showing 22 and Device B showing 1 is expected behavior when:

- Device A created/edited 22 reports offline (or had sync failures leaving `synced_at < updated_at`)
- Device B only has 1 locally-modified report

**The real problem is not count divergence -- it's that Device A's 22 reports are failing to sync.** The fix must address WHY those 22 reports remain stuck in the pending queue.

## Root Cause: Sync Stalls From Cascading Timeouts

The unsynced detection logic (`!synced_at || updated_at > synced_at`) is correct. The issue is that large queues (22 items) trigger cascading failures:

1. **Per-item timeout (25s)** x 22 items = up to 550s theoretical max, but the outer `withSyncTimeout` caps at 5 minutes (300s), killing remaining items mid-batch
2. **Sequential processing**: Each inspection sync involves 8+ database operations (fetch status, delete children, insert children, update synced_at). At 22 items, this compounds
3. **Stale `synced_at` after partial success**: If sync completes for an item on the server but the local `saveInspectionOffline` call (which sets `synced_at`) fails or is interrupted by the outer timeout, the item stays "unsynced" permanently -- a ghost loop

## Fix Implementation

### Fix 1: Batch Size Limiting (Prevents timeout cascade)
In `syncAllInspectionsAtomic`, `syncAllTrainingsAtomic`, and `syncAllDailyAssessmentsAtomic`:
- Process a maximum of **5 items per sync cycle** instead of all at once
- Remaining items sync in subsequent cycles (every 30s desktop / 60s mobile)
- This ensures each cycle completes well within the 5-minute cap

### Fix 2: Immediate Local `synced_at` Update (Prevents ghost loops)
After the server transaction succeeds but before the full `saveInspectionOffline` call:
- Write `synced_at` to the IndexedDB record immediately as a minimal update
- If the subsequent full save fails, the record is still marked as synced

### Fix 3: Progress-Aware Timeout
- Replace the flat 5-minute cap with a **per-batch** timeout: `BASE_SYNC_TIMEOUT + (BATCH_SIZE * PER_ITEM_TIMEOUT_BUDGET)`
- For a batch of 5: 30s + (5 x 8s) = 70s -- well within safe limits

## Technical Details

### Files to modify:

**`src/lib/atomic-sync-manager.ts`**
- Add `MAX_BATCH_SIZE = 5` constant
- In `syncAllInspectionsAtomic` (line ~460): slice `unsynced` to `MAX_BATCH_SIZE` before iterating
- In `syncAllTrainingsAtomic`: same batch limiting
- In `syncAllDailyAssessmentsAtomic`: same batch limiting
- Log remaining count so the user sees progress ("Synced 5/22, 17 remaining")

**`src/hooks/useAutoSync.tsx`**
- Adjust dynamic timeout calculation to use batch size instead of total unsynced count
- After each sync cycle, if items remain, schedule the next cycle sooner (5s instead of 30s) to drain the queue faster

### No database changes required.

## Verification Plan

1. Confirm Device A's 22 pending items begin draining in batches of 5 per cycle
2. After 5 cycles (~2.5 minutes on desktop), count should reach 0
3. Device B's count of 1 should sync normally in a single cycle
4. Simulate a mid-sync network drop to confirm no ghost-synced records remain
