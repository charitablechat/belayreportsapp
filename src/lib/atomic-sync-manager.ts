import { supabase } from "@/integrations/supabase/client";
import { 
  getUnsyncedInspections,
  saveInspectionOffline,
  getOfflineInspection,
  getRelatedDataOffline,
} from "./offline-storage";
import { 
  validateInspectionPackage,
} from "./validation-schemas";
import { 
  executeTransaction,
  TransactionStep 
} from "./transaction-manager";
import { toast } from "sonner";

/**
 * Sync inspection with all related data atomically
 */
export async function syncInspectionAtomic(inspectionId: string) {
  if (!navigator.onLine) {
    throw new Error("Cannot sync while offline");
  }
  
  try {
    // 1. Gather all data for this inspection
    const inspection = await getOfflineInspection(inspectionId);
    if (!inspection) {
      throw new Error("Inspection not found in local storage");
    }
    
    // Verify current user matches inspector_id
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("User not authenticated");
    }
    
    if (inspection.inspector_id !== user.id) {
      if (import.meta.env.DEV) {
        console.error('[Atomic Sync] Inspector ID mismatch:', {
          inspection_inspector_id: inspection.inspector_id,
          current_user_id: user.id
        });
      }
      // Fix the inspector_id to match current user
      inspection.inspector_id = user.id;
      await saveInspectionOffline(inspection);
    }
    
    const [systems, ziplines, equipment, standards, summaryArray] = await Promise.all([
      getRelatedDataOffline('systems', inspectionId),
      getRelatedDataOffline('ziplines', inspectionId),
      getRelatedDataOffline('equipment', inspectionId),
      getRelatedDataOffline('standards', inspectionId),
      getRelatedDataOffline('summary', inspectionId),
    ]);
    
    const summary = summaryArray[0] || null;
    
    // 2. Validate the complete package
    const validation = validateInspectionPackage({
      inspection,
      systems,
      ziplines,
      equipment,
      standards,
      summary,
    });
    
    if (!validation.success) {
      console.error('[Atomic Sync] Validation failed:', validation.errors);
      toast.error(`Validation failed: ${validation.errors[0].message}`);
      throw new Error(`Validation failed: ${JSON.stringify(validation.errors)}`);
    }
    
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Validation passed for:', inspectionId);
    }
    
    // 3. Check for conflicts
    const { data: remoteInspection } = await supabase
      .from("inspections")
      .select("updated_at")
      .eq("id", inspectionId)
      .maybeSingle();
    
    if (remoteInspection) {
      const remoteUpdated = new Date(remoteInspection.updated_at).getTime();
      const localUpdated = new Date(inspection.updated_at).getTime();
      const timeDiff = Math.abs(remoteUpdated - localUpdated);
      
      if (timeDiff > 5000 && remoteUpdated > localUpdated) {
        // Conflict detected - log and skip
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from('sync_conflicts').insert({
          inspection_id: inspectionId,
          organization_id: inspection.organization_id || user?.id || '',
          local_updated_at: inspection.updated_at,
          remote_updated_at: remoteInspection.updated_at,
          resolved: false,
        });
        
        throw new Error("Sync conflict detected - user must resolve");
      }
    }
    
    // 4. Build transaction steps
    const steps: TransactionStep[] = [];
    
    // Step 1: Upsert inspection
    steps.push({
      table: 'inspections',
      operation: 'upsert',
      data: {
        ...inspection,
        synced_at: new Date().toISOString(),
      },
      rollbackData: remoteInspection || null,
    });
    
    // Step 2: Delete existing related data (to handle deletions)
    if (remoteInspection) {
      steps.push(
        { table: 'inspection_systems', operation: 'delete', filter: { inspection_id: inspectionId } },
        { table: 'inspection_ziplines', operation: 'delete', filter: { inspection_id: inspectionId } },
        { table: 'inspection_equipment', operation: 'delete', filter: { inspection_id: inspectionId } },
        { table: 'inspection_standards', operation: 'delete', filter: { inspection_id: inspectionId } },
        { table: 'inspection_summary', operation: 'delete', filter: { inspection_id: inspectionId } }
      );
    }
    
    // Step 3: Insert all related data
    if (systems.length > 0) {
      systems.forEach(system => {
        steps.push({
          table: 'inspection_systems',
          operation: 'insert',
          data: system,
        });
      });
    }
    
    if (ziplines.length > 0) {
      ziplines.forEach(zipline => {
        steps.push({
          table: 'inspection_ziplines',
          operation: 'insert',
          data: zipline,
        });
      });
    }
    
    if (equipment.length > 0) {
      equipment.forEach(item => {
        steps.push({
          table: 'inspection_equipment',
          operation: 'insert',
          data: item,
        });
      });
    }
    
    if (standards.length > 0) {
      standards.forEach(standard => {
        steps.push({
          table: 'inspection_standards',
          operation: 'insert',
          data: standard,
        });
      });
    }
    
    if (summary) {
      steps.push({
        table: 'inspection_summary',
        operation: 'insert',
        data: summary,
      });
    }
    
    // 5. Execute transaction
    const result = await executeTransaction(steps);
    
    if (!result.success) {
      throw new Error(`Transaction failed after ${result.completedSteps}/${result.totalSteps} steps. Rollback: ${result.rollbackSuccess ? 'successful' : 'failed'}`);
    }
    
    // 6. Update local storage with sync timestamp
    await saveInspectionOffline({
      ...inspection,
      synced_at: new Date().toISOString(),
    });
    
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Successfully synced inspection:', inspectionId);
    }
    
    return { success: true };
    
  } catch (error: any) {
    console.error('[Atomic Sync] Failed to sync inspection:', inspectionId, error);
    throw error;
  }
}

/**
 * Sync all unsynced inspections atomically
 */
export async function syncAllInspectionsAtomic() {
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Offline - skipping sync');
    }
    return;
  }
  
  const unsynced = await getUnsyncedInspections();
  
  if (import.meta.env.DEV) {
    console.log('[Atomic Sync] Syncing', unsynced.length, 'inspections atomically');
  }
  
  let successCount = 0;
  let failCount = 0;
  const errors: Array<{ id: string; error: string }> = [];
  
  for (const inspection of unsynced) {
    try {
      await syncInspectionAtomic(inspection.id);
      successCount++;
    } catch (error: any) {
      failCount++;
      errors.push({ id: inspection.id, error: error.message });
      console.error('[Atomic Sync] Failed:', inspection.id, error);
    }
  }
  
  // Show results
  if (successCount > 0) {
    toast.success(`Synced ${successCount} inspection(s) successfully`);
  }
  
  if (failCount > 0) {
    toast.error(`Failed to sync ${failCount} inspection(s)`);
    if (import.meta.env.DEV) {
      console.error('[Atomic Sync] Errors:', errors);
    }
  }
  
  return {
    total: unsynced.length,
    success: successCount,
    failed: failCount,
    errors,
  };
}
