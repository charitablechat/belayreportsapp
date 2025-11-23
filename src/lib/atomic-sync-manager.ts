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
import { syncProgressEmitter } from "@/hooks/useSyncProgress";
import { getMobileCapabilities } from "./mobile-detection";

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
    
    // Since we now filter inspections by user before syncing, this check is just for logging
    if (inspection.inspector_id !== user.id) {
      if (import.meta.env.DEV) {
        console.log('[Atomic Sync] Warning: Inspector ID mismatch (should have been filtered)', {
          inspection_inspector_id: inspection.inspector_id,
          current_user_id: user.id,
        });
      }
      // Silently skip instead of throwing error
      throw new Error("Inspection does not belong to current user");
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
      // Sanitize summary before sync - convert empty strings to null for date fields
      const sanitizedSummary = {
        ...summary,
        next_inspection_date: summary.next_inspection_date === "" ? null : summary.next_inspection_date
      };
      
      steps.push({
        table: 'inspection_summary',
        operation: 'insert',
        data: sanitizedSummary,
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
  const capabilities = getMobileCapabilities();
  
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Offline - skipping sync');
    }
    return;
  }
  
  // Get current user to filter inspections
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("User not authenticated");
  }
  
  // Only get unsynced inspections for the current user
  const unsynced = await getUnsyncedInspections(user.id);
  
  if (import.meta.env.DEV) {
    console.log('[Atomic Sync] Starting sync for all unsynced inspections', {
      count: unsynced.length,
      platform: capabilities.isIOS ? 'iOS' : capabilities.isAndroid ? 'Android' : 'Desktop',
      browser: capabilities.browser,
      isPWA: capabilities.isPWA,
    });
  }
  
  // Emit initial progress
  syncProgressEmitter.emit({
    total: unsynced.length,
    current: 0,
    currentItem: 'Starting sync...',
    phase: 'inspections',
    errors: [],
  });
  
  let successCount = 0;
  let failCount = 0;
  const errors: Array<{ id: string; error: string }> = [];
  
  // Mobile devices get retry logic
  const maxRetries = capabilities.isMobile ? 3 : 1;
  
  for (let i = 0; i < unsynced.length; i++) {
    const inspection = unsynced[i];
    let retryCount = 0;
    let synced = false;
    
    while (retryCount < maxRetries && !synced) {
      // Emit progress for current item
      syncProgressEmitter.emit({
        total: unsynced.length,
        current: i + 1,
        currentItem: `${inspection.organization} - ${inspection.location}${retryCount > 0 ? ` (retry ${retryCount})` : ''}`,
        phase: 'inspections',
        errors,
      });
      
      try {
        await syncInspectionAtomic(inspection.id);
        successCount++;
        synced = true;
        
        if (import.meta.env.DEV) {
          console.log(`[Atomic Sync] Synced ${i + 1}/${unsynced.length}:`, inspection.id);
        }
      } catch (error: any) {
        retryCount++;
        
        if (retryCount < maxRetries) {
          // Exponential backoff for retries
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
          if (import.meta.env.DEV) {
            console.log(`[Atomic Sync] Retry ${retryCount}/${maxRetries} for ${inspection.id} after ${delay}ms`);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          failCount++;
          errors.push({ id: inspection.id, error: error.message });
          console.error('[Atomic Sync] Failed to sync inspection after retries:', inspection.id, error);
        }
      }
    }
  }
  
  // Emit completion
  syncProgressEmitter.emit({
    total: unsynced.length,
    current: unsynced.length,
    currentItem: 'Sync complete',
    phase: 'complete',
    errors,
  });
  
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
