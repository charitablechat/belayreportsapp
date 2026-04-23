import { supabase } from "@/integrations/supabase/client";
import { assertSafeToDeleteChildRows } from "./child-row-deletion-tripwire";

// Timeout for individual database steps to prevent hanging on slow connections
const STEP_TIMEOUT = 15000; // 15 seconds per step (allows large ~2MB records to sync on slower connections)

/**
 * S20: throw an AbortError if the provided signal has been aborted.
 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Operation aborted', 'AbortError');
  }
}

/**
 * Wrap a promise with a timeout to prevent individual steps from blocking.
 * S20: also rejects early when an external AbortSignal fires.
 */
function withStepTimeout<T>(promise: Promise<T>, stepName: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Step timeout: ${stepName}`)),
      STEP_TIMEOUT
    );
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException(`Step aborted: ${stepName}`, 'AbortError'));
    };
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    promise.then(
      (v) => { clearTimeout(timeout); signal?.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { clearTimeout(timeout); signal?.removeEventListener('abort', onAbort); reject(e); }
    );
  });
}

// Tables that are NEVER allowed to have delete operations via the transaction manager
// This is a compile-time/runtime guard against accidental data loss
const REPORT_TABLE_BLOCKLIST = new Set([
  'inspections', 'inspection_systems', 'inspection_ziplines', 'inspection_equipment',
  'inspection_standards', 'inspection_summary', 'inspection_photos',
  'trainings', 'training_delivery_approaches', 'training_operating_systems',
  'training_immediate_attention', 'training_verifiable_items', 'training_systems_in_place',
  'training_summary', 'training_photos',
  'daily_assessments', 'daily_assessment_beginning_of_day', 'daily_assessment_end_of_day',
  'daily_assessment_operating_systems', 'daily_assessment_equipment_checks',
  'daily_assessment_structure_checks', 'daily_assessment_environment_checks',
  'daily_assessment_photos',
]);

export interface TransactionStep {
  table: string;
  operation: 'insert' | 'update' | 'upsert' | 'delete';
  data?: any;
  filter?: any;
  rollbackData?: any; // Data needed to undo this operation
}

export interface TransactionResult {
  success: boolean;
  completedSteps: number;
  totalSteps: number;
  error?: any;
  rollbackSuccess?: boolean;
}

/**
 * Execute multiple database operations as a transaction
 * If any step fails, attempts to rollback all completed steps
 * Supports batch inserts (arrays) for better performance on mobile
 */
export async function executeTransaction(
  steps: TransactionStep[]
): Promise<TransactionResult> {
  const completedSteps: TransactionStep[] = [];
  
  try {
    // Execute each step in order
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      
      if (import.meta.env.DEV) {
        const itemCount = Array.isArray(step.data) ? step.data.length : 1;
        console.log(`[Transaction] Executing step ${i + 1}/${steps.length}:`, step.table, step.operation, `(${itemCount} items)`);
      }
      
      let result;
      
      switch (step.operation) {
        case 'insert':
          // Support both single item and batch insert (arrays)
          result = await withStepTimeout(
            (supabase as any).from(step.table).insert(step.data).select('id'),
            `insert:${step.table}`
          );
          break;
          
        case 'update':
          result = await withStepTimeout(
            (supabase as any).from(step.table).update(step.data).match(step.filter).select('id'),
            `update:${step.table}`
          );
          break;
          
        case 'upsert':
          result = await withStepTimeout(
            (supabase as any).from(step.table).upsert(step.data).select('id'),
            `upsert:${step.table}`
          );
          break;
          
        case 'delete':
          // ZERO DATA LOSS GUARD: Block delete operations on report-related tables
          if (REPORT_TABLE_BLOCKLIST.has(step.table)) {
            console.error(`[Transaction] BLOCKED: Delete operation on protected table "${step.table}". This is a safety guard to prevent data loss.`);
            throw new Error(`Delete operation blocked on protected table: ${step.table}. Use upsert instead.`);
          }
          // Gap B fix: route forward-step deletes through the tripwire
          {
            const fkCol = step.filter ? Object.keys(step.filter)[0] : null;
            const fkVal = fkCol ? step.filter[fkCol] : null;
            if (fkCol && fkVal) {
              const { data: targetRows } = await (supabase as any)
                .from(step.table)
                .select('id')
                .match(step.filter);
              const targetIds = (targetRows || []).map((r: any) => r.id);
              if (targetIds.length > 0) {
                const tw = await assertSafeToDeleteChildRows({
                  table: step.table,
                  parentFkColumn: fkCol,
                  parentId: String(fkVal),
                  idsToDelete: targetIds,
                  context: { source: 'tx_forward_delete', bulk: true, reason: 'transaction_step_delete' },
                });
                if (!tw.allowed) {
                  throw new Error(`Tripwire blocked forward delete on ${step.table}: ${tw.reason}`);
                }
              }
              // Server-side trigger opt-in for legitimate bulk delete
              try { await (supabase as any).rpc('set_bulk_delete_opt_in'); } catch {}
            }
          }
          result = await withStepTimeout(
            (supabase as any).from(step.table).delete().match(step.filter),
            `delete:${step.table}`
          );
          break;
      }
      
      if (result.error) {
        throw new Error(`Step ${i + 1} failed: ${result.error.message}`);
      }
      
      // ROW-COUNT VERIFICATION: Ensure writes actually affected rows
      // Skip for delete operations (already protected by REPORT_TABLE_BLOCKLIST)
      if (step.operation !== 'delete') {
        const returnedRows = result.data?.length ?? 0;
        const expectedRows = Array.isArray(step.data) ? step.data.length : 1;
        
        if (returnedRows === 0) {
          throw new Error(`Step ${i + 1} (${step.operation}:${step.table}) affected 0 rows — possible RLS block or expired session`);
        }
        
        if (Array.isArray(step.data) && returnedRows < expectedRows) {
          console.warn(`[Transaction] Step ${i + 1} (${step.operation}:${step.table}) partial write: ${returnedRows}/${expectedRows} rows`);
          throw new Error(`Step ${i + 1} (${step.operation}:${step.table}) partial write: expected ${expectedRows} rows, got ${returnedRows}`);
        }
      }
      
      completedSteps.push(step);
      
      if (import.meta.env.DEV) {
        console.log(`[Transaction] Step ${i + 1} completed successfully (${result.data?.length ?? 0} rows)`);
      }
    }
    
    // All steps completed successfully
    return {
      success: true,
      completedSteps: steps.length,
      totalSteps: steps.length,
    };
    
  } catch (error: any) {
    console.error('[Transaction] Transaction failed:', error);
    
    // Attempt rollback
    const rollbackSuccess = await rollbackTransaction(completedSteps);
    
    return {
      success: false,
      completedSteps: completedSteps.length,
      totalSteps: steps.length,
      error,
      rollbackSuccess,
    };
  }
}

/**
 * Rollback completed transaction steps
 */
async function rollbackTransaction(
  completedSteps: TransactionStep[]
): Promise<boolean> {
  if (completedSteps.length === 0) return true;
  
  console.log('[Transaction] Rolling back', completedSteps.length, 'steps...');
  
  let allRollbacksSucceeded = true;
  
  // Rollback in reverse order
  for (let i = completedSteps.length - 1; i >= 0; i--) {
    const step = completedSteps[i];
    
    try {
      if (import.meta.env.DEV) {
        console.log(`[Transaction] Rolling back step ${i + 1}:`, step.table, step.operation);
      }
      
      // Reverse the operation
      switch (step.operation) {
        case 'insert':
          // Delete what was inserted - handle both single and batch inserts
          if (Array.isArray(step.data)) {
            // Batch insert - delete all items with IDs
            const ids = step.data.map((item: any) => item.id).filter(Boolean);
            if (ids.length > 0) {
              // Tripwire: rollback is a legitimate bulk delete -- pass bulk:true
              const parentFk = Object.keys(step.filter || {})[0];
              const parentId = parentFk ? step.filter[parentFk] : null;
              if (parentFk && parentId) {
                const tw = await assertSafeToDeleteChildRows({
                  table: step.table,
                  parentFkColumn: parentFk,
                  parentId,
                  idsToDelete: ids,
                  context: { source: 'transaction_rollback', bulk: true, reason: 'rollback_insert' },
                });
                if (!tw.allowed) break;
              }
              // Server-side trigger opt-in for legitimate bulk rollback delete
              try { await (supabase as any).rpc('set_bulk_delete_opt_in'); } catch {}
              await (supabase as any).from(step.table).delete().in('id', ids);
            }
          } else if (step.data?.id) {
            await (supabase as any).from(step.table).delete().eq('id', step.data.id);
          } else if (step.filter) {
            // Fallback to filter-based delete if no ID available
            await (supabase as any).from(step.table).delete().match(step.filter);
          }
          break;
          
        case 'update':
          // Restore previous data if available
          if (step.rollbackData) {
            await (supabase as any)
              .from(step.table)
              .update(step.rollbackData)
              .match(step.filter);
          }
          break;
          
        case 'upsert':
          // S17: Batched upsert rollback — restore array pre-images
          if (Array.isArray(step.rollbackData) && Array.isArray(step.data)) {
            // Pre-image is an array: ids that existed before are restored,
            // ids that didn't exist (genuine inserts) are deleted.
            const preImageIds = new Set(
              step.rollbackData.map((r: any) => r?.id).filter(Boolean)
            );
            const newIds = step.data
              .filter((d: any) => d?.id && !preImageIds.has(d.id))
              .map((d: any) => d.id);
            if (newIds.length > 0) {
              try { await (supabase as any).rpc('set_bulk_delete_opt_in'); } catch {}
              await (supabase as any).from(step.table).delete().in('id', newIds);
            }
            if (step.rollbackData.length > 0) {
              await (supabase as any).from(step.table).upsert(step.rollbackData);
            }
          } else if (step.rollbackData && step.data?.id) {
            // Single-row update rollback (existing behavior)
            await (supabase as any)
              .from(step.table)
              .update(step.rollbackData)
              .eq('id', step.data.id);
          } else if (step.data?.id) {
            // No pre-image — best-effort delete the inserted row
            await (supabase as any).from(step.table).delete().eq('id', step.data.id);
          }
          break;
          
        case 'delete':
          // Restore deleted data if available - handle both single and batch
          if (step.rollbackData) {
            if (Array.isArray(step.rollbackData)) {
              // Batch restore
              if (step.rollbackData.length > 0) {
                await (supabase as any).from(step.table).insert(step.rollbackData);
              }
            } else {
              await (supabase as any).from(step.table).insert(step.rollbackData);
            }
          }
          break;
      }
      
      if (import.meta.env.DEV) {
        console.log(`[Transaction] Rollback step ${i + 1} completed`);
      }
      
    } catch (error) {
      console.error(`[Transaction] Rollback step ${i + 1} failed:`, error);
      allRollbacksSucceeded = false;
    }
  }
  
  if (allRollbacksSucceeded) {
    console.log('[Transaction] Rollback completed successfully');
  } else {
    console.error('[Transaction] Some rollback steps failed - data may be inconsistent');
  }
  
  return allRollbacksSucceeded;
}

/**
 * Prepare rollback data by fetching current state before update (single record)
 */
export async function prepareRollbackData(
  table: string,
  filter: any
): Promise<any> {
  try {
    const { data, error } = await (supabase as any)
      .from(table)
      .select('*')
      .match(filter)
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('[Transaction] Failed to prepare rollback data:', error);
    return null;
  }
}

/**
 * Fetch all matching records for rollback (for delete operations that affect multiple rows)
 * Returns an array of records that can be re-inserted during rollback
 */
export async function fetchRollbackData(
  table: string,
  filter: any
): Promise<any[]> {
  try {
    const { data, error } = await (supabase as any)
      .from(table)
      .select('*')
      .match(filter);
    
    if (error) {
      console.error(`[Transaction] Failed to fetch rollback data for ${table}:`, error);
      return [];
    }
    
    if (import.meta.env.DEV) {
      console.log(`[Transaction] Captured ${data?.length || 0} records from ${table} for rollback`);
    }
    
    return data || [];
  } catch (error) {
    console.error('[Transaction] Failed to fetch rollback data:', error);
    return [];
  }
}
