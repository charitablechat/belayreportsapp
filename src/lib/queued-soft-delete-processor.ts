import { supabase } from '@/integrations/supabase/client';
import {
  getQueuedOperations,
  removeQueuedOperation,
  getQueuedAssessmentOperations,
  removeQueuedAssessmentOperation,
  getQueuedTrainingOperations,
  removeQueuedTrainingOperation,
  getOfflineInspection,
  getOfflineTraining,
  getOfflineDailyAssessment,
} from '@/lib/offline-storage';

export interface SoftDeleteProcessorResult {
  processed: number;
  failed: number;
  errors: string[];
}

/**
 * Determine the Supabase table from the queued operation data.
 * Dashboard queues ALL soft-deletes into the `operations` store using
 * `queueOperation('update', id, { ...reportData, ...softDeleteData })`.
 * We detect the report type from properties on the data object.
 */
function resolveTable(data: any): 'inspections' | 'trainings' | 'daily_assessments' | null {
  if (!data) return null;
  if ('assessment_date' in data && !('start_date' in data)) return 'daily_assessments';
  if ('start_date' in data) return 'trainings';
  if ('inspection_date' in data || 'location' in data) return 'inspections';
  // Fallback: if the data has deleted_at but we can't identify the type, default to inspections
  // since queueOperation is historically inspection-only
  return 'inspections';
}

function isSoftDeleteOp(op: any): boolean {
  return op?.type === 'update' && op?.data?.deleted_at != null;
}

/**
 * Process all queued soft-delete operations from IndexedDB and apply them to the server.
 * Called at the start of each auto-sync cycle when online.
 */
export async function processQueuedSoftDeletes(signal?: AbortSignal): Promise<SoftDeleteProcessorResult> {
  const result: SoftDeleteProcessorResult = { processed: 0, failed: 0, errors: [] };
  if (signal?.aborted) return result;

  try {
    // 1. Process inspection operations queue
    const inspOps = await getQueuedOperations();
    for (const op of inspOps) {
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
          console.error(`[QueuedSoftDelete] Failed to apply soft-delete for ${table}/${recordId}:`, error.message);
          result.failed++;
          result.errors.push(`${table}/${recordId}: ${error.message}`);
        } else {
          await removeQueuedOperation(op.id!);
          result.processed++;
          console.log(`[QueuedSoftDelete] Applied soft-delete: ${table}/${recordId}`);
        }
      } catch (e: any) {
        result.failed++;
        result.errors.push(`${table}/${recordId}: ${e.message}`);
      }
    }

    // 2. Process assessment operations queue
    const assessOps = await getQueuedAssessmentOperations();
    for (const op of assessOps) {
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
          console.error(`[QueuedSoftDelete] Failed assessment soft-delete ${recordId}:`, error.message);
          result.failed++;
          result.errors.push(`daily_assessments/${recordId}: ${error.message}`);
        } else {
          await removeQueuedAssessmentOperation(op.id!);
          result.processed++;
          console.log(`[QueuedSoftDelete] Applied assessment soft-delete: ${recordId}`);
        }
      } catch (e: any) {
        result.failed++;
        result.errors.push(`daily_assessments/${recordId}: ${e.message}`);
      }
    }

    // 3. Process training operations queue
    const trainOps = await getQueuedTrainingOperations();
    for (const op of trainOps) {
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
          console.error(`[QueuedSoftDelete] Failed training soft-delete ${recordId}:`, error.message);
          result.failed++;
          result.errors.push(`trainings/${recordId}: ${error.message}`);
        } else {
          await removeQueuedTrainingOperation(op.id!);
          result.processed++;
          console.log(`[QueuedSoftDelete] Applied training soft-delete: ${recordId}`);
        }
      } catch (e: any) {
        result.failed++;
        result.errors.push(`trainings/${recordId}: ${e.message}`);
      }
    }
  } catch (e: any) {
    console.error('[QueuedSoftDelete] Processor error:', e);
    result.errors.push(`Processor error: ${e.message}`);
  }

  if (result.processed > 0 || result.failed > 0) {
    console.log(`[QueuedSoftDelete] Summary: ${result.processed} processed, ${result.failed} failed`);
  }

  return result;
}

/**
 * Get count of pending soft-delete operations across all queues.
 * Used by the admin UI to show a "pending deletions" indicator.
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
 * S4: Conservative state-aware pruner. Replaces the destructive
 * `clearAllQueued*Operations()` bulk-wipe in the auto-sync loop.
 *
 * Removes queue entries that are stale relative to current IDB state:
 *   - orphans (target record no longer exists locally)
 *   - soft-delete entries whose target is already deleted_at != null locally
 *   - create/update entries whose target has synced_at >= updated_at
 * Leaves anything that still represents real pending work.
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
    if (!rec) return true; // orphan
    if (op?.type === 'update' && op?.data?.deleted_at && rec?.deleted_at) return true;
    if ((op?.type === 'create' || op?.type === 'update') && !op?.data?.deleted_at && isSynced(rec)) {
      return true;
    }
    return false;
  };

  // Inspections
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

  // Trainings
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

  // Assessments
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
