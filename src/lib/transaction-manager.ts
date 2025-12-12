import { supabase } from "@/integrations/supabase/client";

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
        console.log(`[Transaction] Executing step ${i + 1}/${steps.length}:`, step.table, step.operation);
      }
      
      let result;
      
      switch (step.operation) {
        case 'insert':
          result = await (supabase as any).from(step.table).insert(step.data);
          break;
          
        case 'update':
          result = await (supabase as any)
            .from(step.table)
            .update(step.data)
            .match(step.filter);
          break;
          
        case 'upsert':
          result = await (supabase as any).from(step.table).upsert(step.data);
          break;
          
        case 'delete':
          result = await (supabase as any)
            .from(step.table)
            .delete()
            .match(step.filter);
          break;
      }
      
      if (result.error) {
        throw new Error(`Step ${i + 1} failed: ${result.error.message}`);
      }
      
      completedSteps.push(step);
      
      if (import.meta.env.DEV) {
        console.log(`[Transaction] Step ${i + 1} completed successfully`);
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
          // Delete if it was an insert, update if it was an update
          if (step.rollbackData) {
            await (supabase as any)
              .from(step.table)
              .update(step.rollbackData)
              .eq('id', step.data.id);
          } else if (step.data?.id) {
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
 * Prepare rollback data by fetching current state before update
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
