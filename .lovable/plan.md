
## Assessment

Yes — both reported bugs are present in the current codebase, but they do not look like the main explanation for your day-to-day symptoms.

### Present now
- **S2 is definitely present** in all three status helpers:
  - `getRelatedDataOfflineWithStatus`
  - `getTrainingDataOfflineWithStatus`
  - `getAssessmentDataOfflineWithStatus`
  
  They still infer `readSucceeded` by diffing global `indexedDBFailureCount` / circuit-breaker state instead of measuring the specific read call.

- **S1 is also present** in `src/lib/sync-reconciliation.ts`:
  - the 50% guard still blocks legitimate large deletions
  - the absolute delta `>= 3` guard still blocks legitimate deletions
  - the zero-local guard still blocks delete-all cases
  - blocked reconcile still returns `deletedCount: 0`
  - callers still continue and later mark the parent synced

### More likely root cause of your current issues
Your current “data lost / sync not working” symptoms map even more strongly to these existing bugs:

1. **Explicit empty saves are effectively blocked everywhere**
   - `saveRelatedDataOffline`, `saveTrainingDataOffline`, and `saveAssessmentDataOffline` all refuse empty arrays unless `allowEmpty: true`
   - there are currently **no call sites passing `allowEmpty: true`**
   - so “user intentionally deleted all items in a section” is not persisted cleanly to IndexedDB

2. **IndexedDB is visibly timing out in the current session**
   - console already shows repeated `Operation timed out after 5000ms`
   - when that happens, fallback/empty results can flow into save/sync logic

3. **Sync can skip even while unsynced items exist**
   - the log shows `Starting sync... unsyncedCount: 0` followed immediately by many records being logged as unsynced
   - that means the sync gate is relying on stale or fallback counts, so work can be skipped before the real unsynced set is known

## Recommended implementation

### 1) Fix per-read success tracking first
**Files:** `src/lib/offline-storage.ts`

Replace the shared-counter heuristic in all three `*WithStatus` helpers with per-call success detection:
- wrap the specific read in its own `try/catch`
- use a local timeout for that read
- return `{ items, readSucceeded }` based only on that call

Apply to:
- `getRelatedDataOfflineWithStatus`
- `getTrainingDataOfflineWithStatus`
- `getAssessmentDataOfflineWithStatus`

### 2) Make intentional empty sections persist locally
**Files:**  
- `src/lib/offline-storage.ts`
- `src/pages/InspectionForm.tsx`
- `src/pages/TrainingForm.tsx`
- `src/pages/DailyAssessmentForm.tsx`

Introduce explicit delete intent for child arrays:
- when a child section was successfully loaded earlier and is now empty, call the corresponding save with `allowEmpty: true`
- keep the current guard for “never loaded + empty” so timeout fallbacks still do not wipe local data

This is likely the highest-value fix for your actual data-loss complaints.

### 3) Fix reconcile so blocked deletes do not look “synced”
**Files:**  
- `src/lib/sync-reconciliation.ts`
- `src/lib/atomic-sync-manager.ts`

Change reconcile to return structured status:
```ts
{
  deletedCount: number;
  deletedRows: any[];
  blocked: boolean;
  blockReason?: string;
}
```

Then:
- remove the overly aggressive 50% and delta-3 guards
- keep only:
  - “local read definitely failed and local is empty”
  - final live-count tripwire
- if reconcile is blocked, do **not** continue to `align_synced_at`
- return `success: false` / `reason: 'reconcile_blocked'`

This fixes the “looks synced even though deletes never applied” problem.

### 4) Make sync discover real work before early exit
**Files:** `src/hooks/useAutoSync.tsx`

Harden the early exit path:
- refresh unsynced counts at the start of `performSync`, not only after the fact
- or, better, fetch the current unsynced records directly before deciding “nothing to sync”
- never trust a stale in-memory `unsyncedCount` alone when IndexedDB is already timing out

This matches the console evidence you’re seeing now.

### 5) Tune IndexedDB timeout handling for slow devices
**Files:** `src/lib/offline-storage.ts`

The current flat **5s** timeout is likely too aggressive for some Safari/mobile cases.
Adjust by operation type:
- allow longer timeout for batch child reads / multi-store reads
- keep shorter timeout for trivial reads
- log the specific operation name when fallback is used

Goal: fewer false empty reads, fewer skipped sync cycles.

### 6) Add regression tests for the real failure cases
**Files:** test files near `offline-storage` / `sync-reconciliation`

Add tests for:
- intentional delete-all persists with `allowEmpty: true`
- timeout fallback does not mark a successful unrelated read as failed
- reconcile blocked => sync does not report success
- 5→2 legitimate deletion is allowed
- local read failure + empty array still blocks destructive prune

## Priority order

1. **Fix empty-array persistence**
2. **Fix per-read status helpers**
3. **Fix sync early-exit / stale unsynced count**
4. **Fix reconcile blocked => false success**
5. **Tune IDB timeouts and add tests**

## Expected outcome

After these changes:
- local deletions should stop being silently discarded
- sync should stop skipping real unsynced records
- large legitimate deletions should no longer be mislabeled as suspicious
- “synced” should only appear when child reconciliation actually succeeded

So: **yes, S1/S2 are real**, but for the issues you’re actually feeling, the bigger live problems appear to be:
- empty child-section saves never being explicitly allowed
- IndexedDB timeouts causing fallback empties
- sync deciding there is nothing to do before it has a reliable unsynced snapshot
