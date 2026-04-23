import { supabase } from '@/integrations/supabase/client';
import {
  getQueuedOperations,
  removeQueuedOperation,
  updateQueuedOperation,
  getQueuedAssessmentOperations,
  removeQueuedAssessmentOperation,
  updateQueuedAssessmentOperation,
  getQueuedTrainingOperations,
  removeQueuedTrainingOperation,
  updateQueuedTrainingOperation,
  getOfflineInspection,
  getOfflineTraining,
  getOfflineDailyAssessment,
  addToDeadLetterSoftDeletes,
  type DeadLetterSoftDelete,
} from '@/lib/offline-storage';

export interface SoftDeleteProcessorResult {
  processed: number;
  failed: number;
  /** S28: ops moved to dead-letter store after exhausting MAX_SOFT_DELETE_ATTEMPTS */
  deadLettered: number;
  errors: string[];
}

/** S28: ceiling before a queued soft-delete is moved to the dead-letter store. */
export const MAX_SOFT_DELETE_ATTEMPTS = 5;

type QueueStore = 'operations' | 'assessment_operations' | 'training_operations';
type TableName = 'inspections' | 'trainings' | 'daily_assessments';

/**
 * Determine the Supabase table from the queued operation data.
 */
function resolveTable(data: any): TableName | null {
  if (!data) return null;
  if ('assessment_date' in data && !('start_date' in data)) return 'daily_assessments';
  if ('start_date' in data) return 'trainings';
  if ('inspection_date' in data || 'location' in data) return 'inspections';
  return 'inspections';
}

function isSoftDeleteOp(op: any): boolean {
  return op?.type === 'update' && op?.data?.deleted_at != null;
}

interface HandleFailureArgs {
  op: any;
  queueStore: QueueStore;
  table: TableName;
  recordId: string;
  errorMessage: string;
  result: SoftDeleteProcessorResult;
  remove: (id: number) => Promise<unknown>;
  patch: (id: number | undefined | null, patch: Record<string, any>) => Promise<unknown>;
}

/**
 * S28: shared error path. Bumps `attempts`, persists `lastError`/`lastAttemptAt`
 * back to the queued op, and dead-letters once the ceiling is reached.
 */
async function handleSoftDeleteFailure(args: HandleFailureArgs): Promise<void> {
  const { op, queueStore, table, recordId, errorMessage, result, remove, patch } = args;
  const previousAttempts = typeof op.attempts === 'number' ? op.attempts : 0;
  const nextAttempts = previousAttempts + 1;
  const nowIso = new Date().toISOString();

  result.failed++;
  result.errors.push(`${table}/${recordId}: ${errorMessage}`);

  if (nextAttempts >= MAX_SOFT_DELETE_ATTEMPTS) {
    const entry: DeadLetterSoftDelete = {
      id: `${queueStore}:${op.id}:${Date.now()}`,
      queueStore,
      table,
      recordId,
      attempts: nextAttempts,
      firstFailedAt: op.firstFailedAt ?? nowIso,
      lastError: errorMessage,
      deadLetteredAt: nowIso,
      originalOp: op,
    };
    try {
      await addToDeadLetterSoftDeletes(entry);
      await remove(op.id);
      result.deadLettered++;
      console.warn(
        `[QueuedSoftDelete] Dead-lettered after ${nextAttempts} attempts: ${table}/${recordId}`,
        errorMessage
      );
    } catch (dlErr: any) {
      // If dead-letter write fails, leave the op in queue with bumped attempts
      // so we don't silently lose the operation.
      console.error('[QueuedSoftDelete] Dead-letter write failed; leaving op in queue:', dlErr);
      try {
        await patch(op.id, {
          attempts: nextAttempts,
          lastError: errorMessage,
          lastAttemptAt: nowIso,
          firstFailedAt: op.firstFailedAt ?? nowIso,
        });
      } catch { /* ignore */ }
    }
    return;
  }

  // Below ceiling: bump counter and stash error context for diagnostics.
  try {
    await patch(op.id, {
      attempts: nextAttempts,
      lastError: errorMessage,
      lastAttemptAt: nowIso,
      firstFailedAt: op.firstFailedAt ?? nowIso,
    });
  } catch (patchErr) {
    console.warn('[QueuedSoftDelete] Failed to persist attempt counter:', patchErr);
  }
}

/**
 * Process all queued soft-delete operations from IndexedDB and apply them to the server.
 * Called at the start of each auto-sync cycle when online.
 */
export async function processQueuedSoftDeletes(signal?: AbortSignal): Promise<SoftDeleteProcessorResult> {
  const result: SoftDeleteProcessorResult = { processed: 0, failed: 0, deadLettered: 0, errors: [] };
  if (signal?.aborted) return result;

  try {
    // 1. Inspections
    const inspOps = await getQueuedOperations();
    for (const op of inspOps) {
      if (signal?.aborted) return result;
      if (!isSoftDeleteOp(op)) continue;
      const table = resolveTable(op.data);
      if (!table) continue;

      const recordId = op.inspectionId || op.data?.id;
      if (!recordId) continue;

      try {
        const { error } = await supabase
          .from(table)
          .update({
            deleted_at: op.data.deleted_at,
            deleted_by: op.data.deleted_by,
            retention_until: op.data.retention_until,
          })
          .eq('id', recordId);

        if (error) {
          await handleSoftDeleteFailure({
            op, queueStore: 'operations', table, recordId,
            errorMessage: error.message, result,
            remove: removeQueuedOperation,
            patch: updateQueuedOperation,
          });
        } else {
          await removeQueuedOperation(op.id!);
          result.processed++;
          console.log(`[QueuedSoftDelete] Applied soft-delete: ${table}/${recordId}`);
        }
      } catch (e: any) {
        await handleSoftDeleteFailure({
          op, queueStore: 'operations', table, recordId,
          errorMessage: e?.message || String(e), result,
          remove: removeQueuedOperation,
          patch: updateQueuedOperation,
        });
      }
    }

    // 2. Daily assessments
    const assessOps = await getQueuedAssessmentOperations();
    for (const op of assessOps) {
      if (signal?.aborted) return result;
      if (!isSoftDeleteOp(op)) continue;
      const recordId = (op as any).assessmentId || op.data?.id;
      if (!recordId) continue;

      try {
        const { error } = await supabase
          .from('daily_assessments')
          .update({
            deleted_at: op.data.deleted_at,
            deleted_by: op.data.deleted_by,
            retention_until: op.data.retention_until,
          })
          .eq('id', recordId);

        if (error) {
          await handleSoftDeleteFailure({
            op, queueStore: 'assessment_operations', table: 'daily_assessments', recordId,
            errorMessage: error.message, result,
            remove: removeQueuedAssessmentOperation,
            patch: updateQueuedAssessmentOperation,
          });
        } else {
          await removeQueuedAssessmentOperation(op.id!);
          result.processed++;
          console.log(`[QueuedSoftDelete] Applied assessment soft-delete: ${recordId}`);
        }
      } catch (e: any) {
        await handleSoftDeleteFailure({
          op, queueStore: 'assessment_operations', table: 'daily_assessments', recordId,
          errorMessage: e?.message || String(e), result,
          remove: removeQueuedAssessmentOperation,
          patch: updateQueuedAssessmentOperation,
        });
      }
    }

    // 3. Trainings
    const trainOps = await getQueuedTrainingOperations();
    for (const op of trainOps) {
      if (signal?.aborted) return result;
      if (!isSoftDeleteOp(op)) continue;
      const recordId = (op as any).trainingId || op.data?.id;
      if (!recordId) continue;

      try {
        const { error } = await supabase
          .from('trainings')
          .update({
            deleted_at: op.data.deleted_at,
            deleted_by: op.data.deleted_by,
            retention_until: op.data.retention_until,
          })
          .eq('id', recordId);

        if (error) {
          await handleSoftDeleteFailure({
            op, queueStore: 'training_operations', table: 'trainings', recordId,
            errorMessage: error.message, result,
            remove: removeQueuedTrainingOperation,
            patch: updateQueuedTrainingOperation,
          });
        } else {
          await removeQueuedTrainingOperation(op.id!);
          result.processed++;
          console.log(`[QueuedSoftDelete] Applied training soft-delete: ${recordId}`);
        }
      } catch (e: any) {
        await handleSoftDeleteFailure({
          op, queueStore: 'training_operations', table: 'trainings', recordId,
          errorMessage: e?.message || String(e), result,
          remove: removeQueuedTrainingOperation,
          patch: updateQueuedTrainingOperation,
        });
      }
    }
  } catch (e: any) {
    console.error('[QueuedSoftDelete] Processor error:', e);
    result.errors.push(`Processor error: ${e.message}`);
  }

  if (result.processed > 0 || result.failed > 0 || result.deadLettered > 0) {
    console.log(
      `[QueuedSoftDelete] Summary: ${result.processed} processed, ${result.failed} failed, ${result.deadLettered} dead-lettered`
    );
  }

  return result;
}

/**
 * Get count of pending soft-delete operations across all queues.
 */
export async function getPendingSoftDeleteCount(): Promise<number> {
  let count = 0;
  try {
    const inspOps = await getQueuedOperations();
    count += inspOps.filter(isSoftDeleteOp).length;

    const assessOps = await getQueuedAssessmentOperations();
    count += assessOps.filter(isSoftDeleteOp).length;

    const trainOps = await getQueuedTrainingOperations();
    count += trainOps.filter(isSoftDeleteOp).length;
  } catch (e) {
    console.warn('[QueuedSoftDelete] Error counting pending:', e);
  }
  return count;
}

/**
 * S4: Conservative state-aware pruner.
 */
export async function pruneCompletedQueuedOperations(): Promise<{
  inspections: number;
  trainings: number;
  assessments: number;
}> {
  const counts = { inspections: 0, trainings: 0, assessments: 0 };

  const isSynced = (rec: any): boolean => {
    if (!rec?.synced_at) return false;
    if (!rec?.updated_at) return true;
    return new Date(rec.synced_at).getTime() >= new Date(rec.updated_at).getTime();
  };

  const shouldDrop = (op: any, rec: any): boolean => {
    if (!rec) return true;
    if (op?.type === 'update' && op?.data?.deleted_at && rec?.deleted_at) return true;
    if ((op?.type === 'create' || op?.type === 'update') && !op?.data?.deleted_at && isSynced(rec)) {
      return true;
    }
    return false;
  };

  try {
    const ops = await getQueuedOperations();
    for (const op of ops) {
      const id = (op as any).inspectionId || op.data?.id;
      if (!id) {
        try { await removeQueuedOperation(op.id!); counts.inspections++; } catch {}
        continue;
      }
      const rec = await getOfflineInspection(id).catch(() => null);
      if (shouldDrop(op, rec)) {
        try { await removeQueuedOperation(op.id!); counts.inspections++; } catch {}
      }
    }
  } catch (e) {
    console.warn('[PruneQueue] inspections prune failed (non-blocking):', e);
  }

  try {
    const ops = await getQueuedTrainingOperations();
    for (const op of ops) {
      const id = (op as any).trainingId || op.data?.id;
      if (!id) {
        try { await removeQueuedTrainingOperation(op.id!); counts.trainings++; } catch {}
        continue;
      }
      const rec = await getOfflineTraining(id).catch(() => null);
      if (shouldDrop(op, rec)) {
        try { await removeQueuedTrainingOperation(op.id!); counts.trainings++; } catch {}
      }
    }
  } catch (e) {
    console.warn('[PruneQueue] trainings prune failed (non-blocking):', e);
  }

  try {
    const ops = await getQueuedAssessmentOperations();
    for (const op of ops) {
      const id = (op as any).assessmentId || op.data?.id;
      if (!id) {
        try { await removeQueuedAssessmentOperation(op.id!); counts.assessments++; } catch {}
        continue;
      }
      const rec = await getOfflineDailyAssessment(id).catch(() => null);
      if (shouldDrop(op, rec)) {
        try { await removeQueuedAssessmentOperation(op.id!); counts.assessments++; } catch {}
      }
    }
  } catch (e) {
    console.warn('[PruneQueue] assessments prune failed (non-blocking):', e);
  }

  const total = counts.inspections + counts.trainings + counts.assessments;
  if (total > 0) {
    console.log(`[PruneQueue] Pruned ${total} completed queue entries`, counts);
  }

  return counts;
}

/**
 * S28: Push a dead-lettered entry back into its original queue store with
 * `attempts` reset to 0. The next sync cycle will retry it.
 */
export async function retryDeadLetterSoftDelete(entry: DeadLetterSoftDelete): Promise<boolean> {
  try {
    const { getDB } = await import('@/lib/offline-storage');
    const db: any = await getDB();
    const restored = {
      ...entry.originalOp,
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    };
    delete restored.id; // let autoIncrement assign a fresh key
    await db.add(entry.queueStore, restored);
    const { removeDeadLetterSoftDelete } = await import('@/lib/offline-storage');
    await removeDeadLetterSoftDelete(entry.id);
    return true;
  } catch (e) {
    console.error('[QueuedSoftDelete] Retry from dead-letter failed:', e);
    return false;
  }
}
