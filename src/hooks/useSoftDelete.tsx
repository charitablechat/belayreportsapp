import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { addDays } from "date-fns";
import { 
  deleteOfflineInspection, 
  deleteOfflineTraining, 
  deleteOfflineDailyAssessment,
} from "@/lib/offline-storage";

export type SoftDeleteTable = 'inspections' | 'trainings' | 'daily_assessments';

export interface SoftDeleteOptions {
  retentionDays?: number;
}

export interface DeletedRecord {
  table_name: string;
  record_id: string;
  deleted_at: string;
  deleted_by: string;
  retention_until: string;
  days_remaining: number;
  organization: string;
  record_date: string;
  deleter_name: string;
}

/**
 * Hook for soft-delete operations with 60-day retention
 */
export function useSoftDelete() {
  /**
   * Soft delete a record (sets deleted_at, deleted_by, retention_until)
   * Instead of permanently deleting, marks the record for future cleanup
   */
  const softDelete = useCallback(async (
    table: SoftDeleteTable,
    recordId: string,
    userId: string,
    options: SoftDeleteOptions = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const { retentionDays = 60 } = options;
    
    const now = new Date();
    const retentionUntil = addDays(now, retentionDays);

    const updateData = {
      deleted_at: now.toISOString(),
      deleted_by: userId,
      retention_until: retentionUntil.toISOString(),
    };

    try {
      if (navigator.onLine) {
        // Use SECURITY DEFINER RPC to bypass the RLS visibility gap
        // (UPDATE … RETURNING returns 0 rows once deleted_at is set, because
        // the user-level SELECT policy filters out soft-deleted rows).
        const { data, error } = await supabase.rpc('soft_delete_record', {
          p_table_name: table,
          p_record_id: recordId,
          p_deleted_by: userId,
          p_retention_days: retentionDays,
        });

        if (error) {
          console.error(`[SoftDelete] Error soft-deleting ${table}:`, error);
          return { success: false, error: error.message };
        }

        if (data === false) {
          return { success: false, error: 'Record could not be deleted (already deleted or not found).' };
        }

        if (import.meta.env.DEV) {
          console.log(`[SoftDelete] Record soft-deleted:`, { table, recordId, retentionUntil });
        }
      } else {
        // When offline, we can still update offline storage and the user won't see the record
        // The soft-delete will be synced when back online via the normal update flow
        if (import.meta.env.DEV) {
          console.log(`[SoftDelete] Offline - record will be soft-deleted when online:`, { table, recordId });
        }
        // For now, just return success - the record will remain visible until online sync
        // A more robust solution would queue the soft-delete operation
        return { success: false, error: 'Cannot soft-delete while offline. Please connect to the internet.' };
      }

      // Remove from local offline storage (it will still exist in DB for recovery)
      switch (table) {
        case 'inspections':
          await deleteOfflineInspection(recordId);
          break;
        case 'trainings':
          await deleteOfflineTraining(recordId);
          break;
        case 'daily_assessments':
          await deleteOfflineDailyAssessment(recordId);
          break;
      }

      return { success: true };
    } catch (error: any) {
      console.error(`[SoftDelete] Exception:`, error);
      return { success: false, error: error.message };
    }
  }, []);

  /**
   * Restore a soft-deleted record (clears deleted_at, deleted_by, retention_until)
   * Only super admins can restore records
   */
  const restoreRecord = useCallback(async (
    table: SoftDeleteTable,
    recordId: string
  ): Promise<{ success: boolean; error?: string; restoredRow?: any }> => {
    try {
      const { data, error } = await supabase
        .from(table)
        .update({
          deleted_at: null,
          deleted_by: null,
          retention_until: null,
        })
        .eq('id', recordId)
        .select()
        .single();

      if (error) {
        console.error(`[SoftDelete] Error restoring ${table}:`, error);
        return { success: false, error: error.message };
      }

      if (import.meta.env.DEV) {
        console.log(`[SoftDelete] Record restored:`, { table, recordId, data });
      }

      return { success: true, restoredRow: data };
    } catch (error: any) {
      console.error(`[SoftDelete] Exception restoring:`, error);
      return { success: false, error: error.message };
    }
  }, []);

  /**
   * Permanently delete a record (bypasses retention period)
   * Only super admins can permanently delete
   */
  const permanentDelete = useCallback(async (
    table: SoftDeleteTable,
    recordId: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', recordId);

      if (error) {
        console.error(`[SoftDelete] Error permanently deleting ${table}:`, error);
        return { success: false, error: error.message };
      }

      if (import.meta.env.DEV) {
        console.log(`[SoftDelete] Record permanently deleted:`, { table, recordId });
      }

      return { success: true };
    } catch (error: any) {
      console.error(`[SoftDelete] Exception:`, error);
      return { success: false, error: error.message };
    }
  }, []);

  /**
   * Fetch all soft-deleted records for recovery UI
   * Only super admins can access this
   */
  const getDeletedRecords = useCallback(async (
    table?: SoftDeleteTable
  ): Promise<{ data: DeletedRecord[] | null; error?: string }> => {
    try {
      const { data, error } = await supabase.rpc('get_deleted_records', {
        p_table_name: table || null
      });

      if (error) {
        console.error(`[SoftDelete] Error fetching deleted records:`, error);
        return { data: null, error: error.message };
      }

      return { data: data as DeletedRecord[] };
    } catch (error: any) {
      console.error(`[SoftDelete] Exception fetching deleted records:`, error);
      return { data: null, error: error.message };
    }
  }, []);

  /**
   * Run cleanup to permanently delete expired records
   * Only super admins can trigger this
   */
  const runCleanup = useCallback(async (): Promise<{ 
    success: boolean; 
    counts?: { inspections: number; trainings: number; daily_assessments: number };
    error?: string 
  }> => {
    try {
      const { data, error } = await supabase.rpc('cleanup_expired_deleted_records');

      if (error) {
        console.error(`[SoftDelete] Error running cleanup:`, error);
        return { success: false, error: error.message };
      }

      const result = data?.[0];
      return { 
        success: true, 
        counts: {
          inspections: result?.inspections_deleted || 0,
          trainings: result?.trainings_deleted || 0,
          daily_assessments: result?.daily_assessments_deleted || 0,
        }
      };
    } catch (error: any) {
      console.error(`[SoftDelete] Exception running cleanup:`, error);
      return { success: false, error: error.message };
    }
  }, []);

  /**
   * Get retention status badge info based on days remaining
   */
  const getRetentionBadge = useCallback((daysRemaining: number): {
    variant: 'destructive' | 'secondary' | 'default';
    label: string;
    color: string;
  } => {
    if (daysRemaining <= 7) {
      return { 
        variant: 'destructive', 
        label: `${daysRemaining}d left`, 
        color: 'text-destructive' 
      };
    } else if (daysRemaining <= 30) {
      return { 
        variant: 'secondary', 
        label: `${daysRemaining}d left`, 
        color: 'text-orange-500' 
      };
    } else {
      return { 
        variant: 'default', 
        label: `${daysRemaining}d left`, 
        color: 'text-green-500' 
      };
    }
  }, []);

  /**
   * Batch permanently delete multiple records
   * Returns a summary of successes and failures
   */
  const batchPermanentDelete = useCallback(async (
    entries: { table: SoftDeleteTable; recordId: string }[]
  ): Promise<{ succeeded: number; failed: number }> => {
    let succeeded = 0;
    let failed = 0;

    for (const entry of entries) {
      const { success } = await permanentDelete(entry.table, entry.recordId);
      if (success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    return { succeeded, failed };
  }, [permanentDelete]);

  return {
    softDelete,
    restoreRecord,
    permanentDelete,
    batchPermanentDelete,
    getDeletedRecords,
    runCleanup,
    getRetentionBadge,
  };
}
