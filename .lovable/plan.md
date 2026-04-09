

# Sync System Gaps Analysis

## Gap 1: Dashboard queues trainings & assessments into the WRONG queue (HIGH)

**Location**: `src/pages/Dashboard.tsx` lines 1033, 1064

When offline-deleting a **training** or **daily assessment** from the Dashboard, the code uses `queueOperation()` (the **inspection** operations queue) instead of `queueTrainingOperation()` or `queueAssessmentOperation()`. 

The soft-delete processor (`queued-soft-delete-processor.ts`) handles this by detecting the report type from data properties (`resolveTable`), so the delete *does* eventually get applied. However, the post-sync cleanup in `useAutoSync` calls `clearAllQueuedOperations()` — which wipes the entire inspection operations queue **including these misplaced training/assessment soft-deletes that haven't been processed yet**.

**Fix**: In `Dashboard.tsx`, change the two offline soft-delete calls:
- Line ~1033: `queueOperation(...)` → `queueAssessmentOperation('update', reportToDelete.id, ...)`
- Line ~1064: `queueOperation(...)` → `queueTrainingOperation('update', reportToDelete.id, ...)`

This ensures soft-deletes land in the correct queue and won't be accidentally cleared.

---

## Gap 2: Post-sync queue flush is too aggressive (HIGH)

**Location**: `src/hooks/useAutoSync.tsx` lines 294-299

The current cleanup calls `clearAllQueuedOperations()`, `clearAllQueuedTrainingOperations()`, and `clearAllQueuedAssessmentOperations()` whenever **any** sync succeeds. This wipes **all** entries — including **soft-delete** entries that the `processQueuedSoftDeletes` processor may not have processed yet (e.g., if the soft-delete Supabase call failed, the processor logs the failure and moves on, but the entry is preserved for retry next cycle).

**Fix**: Only clear non-soft-delete entries. After the `anySuccess` check, filter out soft-delete entries before clearing:
- Import `getQueuedOperations`, `getQueuedTrainingOperations`, `getQueuedAssessmentOperations` and their individual `remove*` counterparts
- Loop through each queue, remove entries where `data.deleted_at` is **null/undefined** (non-soft-delete, already handled by atomic sync)
- Leave soft-delete entries intact for the processor to retry

---

## Gap 3: Inspection/assessment atomic sync doesn't clean its operation queue (LOW)

**Location**: `src/lib/atomic-sync-manager.ts`

The recent fix added per-item queue cleanup for **training** operations after sync, but `syncInspectionAtomic` and `syncDailyAssessmentAtomic` don't have the same cleanup. This is now **LOW** priority because the post-sync sweep in `useAutoSync` handles it — but for consistency and as defense-in-depth, the same pattern should be added.

**Fix**: Add the same `getQueuedOperations` / `getQueuedAssessmentOperations` cleanup blocks at the end of `syncInspectionAtomic` and `syncDailyAssessmentAtomic`, matching the pattern in `syncTrainingAtomic`.

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Use correct queue functions for training/assessment offline soft-deletes |
| `src/hooks/useAutoSync.tsx` | Replace blanket `clearAll*` with selective non-soft-delete cleanup |
| `src/lib/atomic-sync-manager.ts` | Add per-item queue cleanup to inspection and assessment sync (consistency) |

