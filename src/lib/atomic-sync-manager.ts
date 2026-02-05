import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache, ensureValidSession } from "@/lib/cached-auth";
import { 
  getUnsyncedInspections,
  saveInspectionOffline,
  getOfflineInspection,
  getRelatedDataOffline,
  getUnsyncedTrainings,
  saveTrainingOffline,
  getOfflineTraining,
  getTrainingDataOffline,
  getUnsyncedDailyAssessments,
  saveDailyAssessmentOffline,
  getOfflineDailyAssessment,
  getAssessmentDataOffline,
} from "./offline-storage";
import { 
  validateInspectionPackage,
} from "./validation-schemas";
import {
  validateTrainingPackage,
} from "./training-validation-schemas";
import {
  validateDailyAssessmentPackage,
} from "./daily-assessment-validation-schemas";
import { 
  executeTransaction,
  TransactionStep,
  fetchRollbackData
} from "./transaction-manager";
import { syncProgressEmitter } from "@/hooks/useSyncProgress";
import { getMobileCapabilities } from "./mobile-detection";
import { getCachedProfile } from "./profile-cache";
import {
  deleteOfflineInspection,
  deleteOfflineTraining,
  deleteOfflineDailyAssessment,
} from "./offline-storage";

/**
 * Interface for record status returned by check_record_status RPC
 * Used to bypass RLS and check if a record was soft-deleted
 */
interface RecordStatus {
  record_exists: boolean;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
  updated_at: string | null;
  synced_at: string | null;
}

/**
 * Check remote record status using RLS-bypassing RPC function
 * This allows detecting soft-deleted records that regular users can't see via normal SELECT
 * 
 * @param tableName - The table to check ('inspections' | 'trainings' | 'daily_assessments')
 * @param recordId - The UUID of the record to check
 * @returns RecordStatus or null if record doesn't exist or error occurred
 */
async function checkRemoteRecordStatus(
  tableName: 'inspections' | 'trainings' | 'daily_assessments',
  recordId: string
): Promise<RecordStatus | null> {
  try {
    const { data, error } = await supabase
      .rpc('check_record_status', {
        p_table_name: tableName,
        p_record_id: recordId
      })
      .maybeSingle();
    
    if (error) {
      console.error('[Atomic Sync] Error checking record status:', error);
      return null;
    }
    
    return data as RecordStatus | null;
  } catch (e) {
    console.error('[Atomic Sync] Exception checking record status:', e);
    return null;
  }
}

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
    
    // CRITICAL: Ensure we have a valid JWT before any database operations
    // This prevents RLS failures due to expired tokens on mobile
    const user = await ensureValidSession();
    if (!user) {
      console.error('[Atomic Sync] No valid session - sync aborted for inspection:', inspectionId);
      return { success: false, skipped: true, reason: 'invalid_session' };
    }
    
    // Skip inspections that don't belong to current user (they were filtered but double-check)
    if (inspection.inspector_id !== user.id) {
      if (import.meta.env.DEV) {
        console.log('[Atomic Sync] Skipping inspection - belongs to different user', {
          inspection_id: inspectionId,
        });
      }
      return { success: false, skipped: true, reason: 'ownership_mismatch' };
    }
    
    const [rawSystems, rawZiplines, rawEquipment, rawStandards, summaryArray] = await Promise.all([
      getRelatedDataOffline('systems', inspectionId),
      getRelatedDataOffline('ziplines', inspectionId),
      getRelatedDataOffline('equipment', inspectionId),
      getRelatedDataOffline('standards', inspectionId),
      getRelatedDataOffline('summary', inspectionId),
    ]);
    
    const rawSummary = summaryArray[0] || null;
    
    // Transform temp- IDs to valid UUIDs before validation
    // These temp IDs are created in the UI for new rows but need real UUIDs for DB
    const transformTempIds = <T extends { id?: string }>(items: T[]): T[] => {
      return items.map(item => ({
        ...item,
        id: item.id?.startsWith('temp-') ? crypto.randomUUID() : item.id
      }));
    };
    
    const systems = transformTempIds(rawSystems);
    const ziplines = transformTempIds(rawZiplines);
    const equipment = transformTempIds(rawEquipment);
    const standards = transformTempIds(rawStandards);
    const summary = rawSummary?.id?.startsWith('temp-') 
      ? { ...rawSummary, id: crypto.randomUUID() } 
      : rawSummary;
    
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
      throw new Error(`Validation failed: ${JSON.stringify(validation.errors)}`);
    }
    
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Validation passed for:', inspectionId);
    }
    
    // 3. Check for remote record status using RLS-bypassing RPC
    // This allows detecting soft-deleted records that regular users can't see via normal SELECT
    const recordStatus = await checkRemoteRecordStatus('inspections', inspectionId);
    
    // SAFEGUARD: Check if remote record was soft-deleted by someone else
    // This works for ALL users (regular and super admin) by bypassing RLS
    if (recordStatus?.record_exists && recordStatus?.is_deleted) {
      console.warn('[Atomic Sync] Remote record was soft-deleted - cleaning up local copy:', inspectionId);
      
      // Mark the local record as deleted to match remote state
      // This prevents repeated sync attempts for orphaned local data
      try {
        await deleteOfflineInspection(inspectionId);
        console.log('[Atomic Sync] Cleaned up orphaned local inspection:', inspectionId);
      } catch (cleanupError) {
        console.error('[Atomic Sync] Failed to clean up orphaned local data:', cleanupError);
      }
      
      return { 
        success: false, 
        skipped: true, 
        reason: 'remote_deleted',
        message: 'This record was deleted by an administrator. Local copy has been cleaned up.'
      };
    }
    
    // Use recordStatus for conflict detection if available
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      const remoteUpdated = new Date(recordStatus.updated_at!).getTime();
      const localUpdated = new Date(inspection.updated_at).getTime();
      const timeDiff = Math.abs(remoteUpdated - localUpdated);
      
      // PREVENTIVE MEASURE: Skip conflict detection if local data was never synced
      // or if the inspection has already been synced after the local update
      const localSyncedAt = inspection.synced_at ? new Date(inspection.synced_at).getTime() : 0;
      const isAlreadySynced = localSyncedAt >= localUpdated;
      
      // Only flag as conflict if:
      // 1. Remote is significantly newer (>5 seconds)
      // 2. Remote was updated AFTER our last sync (genuine concurrent edit)
      // 3. Local changes haven't been synced yet
      if (timeDiff > 5000 && remoteUpdated > localUpdated && !isAlreadySynced) {
        // Additional check: verify remote was updated after our last known sync
        const remoteUpdatedAfterOurSync = localSyncedAt === 0 || remoteUpdated > localSyncedAt;
        
        if (!remoteUpdatedAfterOurSync) {
          // Remote change predates our last sync - not a real conflict, proceed with sync
          if (import.meta.env.DEV) {
            console.log('[Atomic Sync] Skipping conflict - remote change predates our last sync');
          }
        } else {
          // Check if an unresolved conflict already exists for this inspection
          const { data: existingConflict } = await supabase
            .from('sync_conflicts')
            .select('id')
            .eq('inspection_id', inspectionId)
            .eq('resolved', false)
            .maybeSingle();
          
          if (!existingConflict) {
            // Validate organization_id - must have a valid value
            const organizationId = inspection.organization_id;
            if (!organizationId) {
              console.error('[Atomic Sync] Cannot record conflict - missing organization_id for inspection:', inspectionId);
              throw new Error('Sync conflict detected but organization_id is missing');
            }
            
            // No existing conflict - record a new one (will be auto-resolved silently)
            const { error: conflictError } = await supabase.from('sync_conflicts').insert({
              inspection_id: inspectionId,
              organization_id: organizationId,
              local_updated_at: inspection.updated_at,
              remote_updated_at: recordStatus.updated_at!,
              resolved: false,
            });
            
            if (conflictError) {
              console.error('[Atomic Sync] Failed to record conflict:', conflictError);
            }
            // No toast notifications - conflicts are resolved automatically via useConflicts hook
          } else {
            if (import.meta.env.DEV) {
              console.log('[Atomic Sync] Conflict already exists for inspection:', inspectionId);
            }
          }
          
          // Return success - the useConflicts hook will handle auto-resolution
          return { success: true, conflict: true };
        }
      }
    }
    // 4. Build transaction steps
    const steps: TransactionStep[] = [];
    
    // Exclude joined 'inspector' object - only inspector_id column exists in DB
    const { inspector, ...inspectionWithoutJoin } = inspection as any;
    
    // For rollback, capture both synced_at and updated_at for proper state restoration
    const rollbackData = recordStatus?.record_exists 
      ? { synced_at: recordStatus.synced_at, updated_at: recordStatus.updated_at } 
      : null;
    
    // Step 1: Upsert inspection WITHOUT setting synced_at (defer to final step)
    // This ensures synced_at is only set after ALL related data is committed
    steps.push({
      table: 'inspections',
      operation: 'upsert',
      data: {
        ...inspectionWithoutJoin,
        // DO NOT set synced_at here - it will be set in the final step
      },
      rollbackData,
    });
    
    // Step 2: Delete existing related data (to handle deletions)
    // Capture existing data for rollback safety before deletion
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      // Fetch existing related data for rollback
      const [
        existingSystems,
        existingZiplines,
        existingEquipment,
        existingStandards,
        existingSummary
      ] = await Promise.all([
        fetchRollbackData('inspection_systems', { inspection_id: inspectionId }),
        fetchRollbackData('inspection_ziplines', { inspection_id: inspectionId }),
        fetchRollbackData('inspection_equipment', { inspection_id: inspectionId }),
        fetchRollbackData('inspection_standards', { inspection_id: inspectionId }),
        fetchRollbackData('inspection_summary', { inspection_id: inspectionId }),
      ]);
      
      steps.push(
        { table: 'inspection_systems', operation: 'delete', filter: { inspection_id: inspectionId }, rollbackData: existingSystems },
        { table: 'inspection_ziplines', operation: 'delete', filter: { inspection_id: inspectionId }, rollbackData: existingZiplines },
        { table: 'inspection_equipment', operation: 'delete', filter: { inspection_id: inspectionId }, rollbackData: existingEquipment },
        { table: 'inspection_standards', operation: 'delete', filter: { inspection_id: inspectionId }, rollbackData: existingStandards },
        { table: 'inspection_summary', operation: 'delete', filter: { inspection_id: inspectionId }, rollbackData: existingSummary }
      );
    }
    
    // Step 3: Insert all related data as BATCH operations (much faster on mobile)
    // Instead of N individual inserts, use single bulk insert per table
    if (systems.length > 0) {
      steps.push({
        table: 'inspection_systems',
        operation: 'insert',
        data: systems, // Batch insert all at once
      });
    }
    
    if (ziplines.length > 0) {
      steps.push({
        table: 'inspection_ziplines',
        operation: 'insert',
        data: ziplines, // Batch insert all at once
      });
    }
    
    if (equipment.length > 0) {
      steps.push({
        table: 'inspection_equipment',
        operation: 'insert',
        data: equipment, // Batch insert all at once
      });
    }
    
    if (standards.length > 0) {
      steps.push({
        table: 'inspection_standards',
        operation: 'insert',
        data: standards, // Batch insert all at once
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
        data: [sanitizedSummary], // Wrap in array for consistency
      });
    }
    
    // FINAL STEP: Set synced_at ONLY after all related data is successfully inserted
    // This is the atomic guarantee - synced_at only updates when everything commits
    steps.push({
      table: 'inspections',
      operation: 'update',
      data: { synced_at: new Date().toISOString() },
      filter: { id: inspectionId },
    });
    
    // 5. Execute transaction
    const result = await executeTransaction(steps);
    
    if (!result.success) {
      throw new Error(`Transaction failed after ${result.completedSteps}/${result.totalSteps} steps. Rollback: ${result.rollbackSuccess ? 'successful' : 'failed'}`);
    }
    
    // 6. Get cached inspector profile to attach to offline data
    const inspectorProfile = await getCachedProfile(user.id);
    
    // Update local storage with sync timestamp and inspector profile
    await saveInspectionOffline({
      ...inspection,
      synced_at: new Date().toISOString(),
      inspector: inspectorProfile || { first_name: null, last_name: null, avatar_url: null },
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
  const ITEM_SYNC_TIMEOUT = 25000; // 25 seconds per item max (increased for mobile networks)
  
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Offline - skipping sync');
    }
    return;
  }
  
  // CRITICAL: Validate session before sync to ensure valid JWT for RLS
  let user;
  try {
    user = await Promise.race([
      ensureValidSession(),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 5000))
    ]);
  } catch (e) {
    console.warn('[Atomic Sync] Session validation timed out, skipping sync');
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  if (!user) {
    console.warn('[Atomic Sync] No valid session, skipping sync');
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  // Only get unsynced inspections for the current user (with extended timeout for mobile)
  // Note: getUnsyncedInspections already has internal timeout via withIndexedDBErrorBoundary
  // The outer timeout here is a safety net for very slow mobile networks
  // Increased to 15s to avoid racing with inner 5s timeout + 3s health check
  let unsynced: any[];
  let fetchTimedOut = false;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('IndexedDB timeout')), 15000)
    );
    
    unsynced = await Promise.race([
      getUnsyncedInspections(user.id),
      timeoutPromise
    ]);
  } catch (e: any) {
    if (e.message === 'IndexedDB timeout') {
      console.warn('[Atomic Sync] IndexedDB timeout getting unsynced inspections - will retry next cycle');
      fetchTimedOut = true;
    } else {
      console.warn('[Atomic Sync] Failed to get unsynced inspections:', e);
    }
    unsynced = [];
  }
  
  // Don't report success if we failed to fetch data (total: -1 signals fetch failure)
  if (fetchTimedOut) {
    return { total: -1, success: 0, failed: 0, errors: [{ id: 'indexeddb', error: 'Timeout fetching inspections' }] };
  }
  
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
  const maxRetries = capabilities.isMobile ? 2 : 1; // Reduced retries for faster recovery
  
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
        // Per-item timeout to prevent single item from blocking entire sync
        await Promise.race([
          syncInspectionAtomic(inspection.id),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Item sync timeout')), ITEM_SYNC_TIMEOUT))
        ]);
        successCount++;
        synced = true;
        
        if (import.meta.env.DEV) {
          console.log(`[Atomic Sync] Synced ${i + 1}/${unsynced.length}:`, inspection.id);
        }
      } catch (error: any) {
        retryCount++;
        
        if (retryCount < maxRetries) {
          // Reduced backoff for faster iteration
          const delay = Math.min(500 * retryCount, 2000);
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
  
  // Log results
  if (import.meta.env.DEV) {
    console.log('[Atomic Sync] Results:', {
      total: unsynced.length,
      success: successCount,
      failed: failCount,
    });
    if (failCount > 0) {
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

/**
 * Helper function to validate UUID format
 */
function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Helper function to transform temp- IDs and invalid IDs to valid UUIDs
 * This handles:
 * - temp- prefixed IDs from UI
 * - Composite IDs that were incorrectly generated (e.g., "uuid-type-timestamp-random")
 * - Missing IDs
 */
function transformTempIds<T extends { id?: string }>(items: T[]): T[] {
  return items.map(item => {
    // Transform if: no id, starts with temp-, or not a valid UUID format
    const needsTransform = !item.id || 
      item.id.startsWith('temp-') || 
      !isValidUUID(item.id);
    
    return {
      ...item,
      id: needsTransform ? crypto.randomUUID() : item.id
    };
  });
}

/**
 * Sync training with all related data atomically
 */
export async function syncTrainingAtomic(trainingId: string) {
  if (!navigator.onLine) {
    throw new Error("Cannot sync while offline");
  }
  
  try {
    // 1. Gather all data for this training
    const training = await getOfflineTraining(trainingId);
    if (!training) {
      throw new Error("Training not found in local storage");
    }
    
    // CRITICAL: Ensure we have a valid JWT before any database operations
    // This prevents RLS failures due to expired tokens on mobile
    const user = await ensureValidSession();
    if (!user) {
      console.error('[Atomic Sync] No valid session - sync aborted for training:', trainingId);
      return { success: false, skipped: true, reason: 'invalid_session' };
    }
    
    // Skip trainings that don't belong to current user
    if (training.inspector_id !== user.id) {
      if (import.meta.env.DEV) {
        console.log('[Atomic Sync] Skipping training - belongs to different user', {
          training_id: trainingId,
        });
      }
      return { success: false, skipped: true, reason: 'ownership_mismatch' };
    }
    
    const [rawDeliveryApproaches, rawOperatingSystems, rawImmediateAttention, rawVerifiableItems, rawSystemsInPlace, summaryArray] = await Promise.all([
      getTrainingDataOffline('delivery_approaches', trainingId),
      getTrainingDataOffline('operating_systems', trainingId),
      getTrainingDataOffline('immediate_attention', trainingId),
      getTrainingDataOffline('verifiable_items', trainingId),
      getTrainingDataOffline('systems_in_place', trainingId),
      getTrainingDataOffline('summary', trainingId),
    ]);
    
    const rawSummary = summaryArray[0] || null;
    
    // Transform temp- IDs to valid UUIDs before validation
    const delivery_approaches = transformTempIds(rawDeliveryApproaches);
    const operating_systems = transformTempIds(rawOperatingSystems);
    const immediate_attention = transformTempIds(rawImmediateAttention);
    const verifiable_items = transformTempIds(rawVerifiableItems);
    const systems_in_place = transformTempIds(rawSystemsInPlace);
    const summary = rawSummary?.id?.startsWith('temp-') 
      ? { ...rawSummary, id: crypto.randomUUID() } 
      : rawSummary;
    
    // 2. Validate the complete package
    const validation = validateTrainingPackage({
      training,
      delivery_approaches,
      operating_systems,
      immediate_attention,
      verifiable_items,
      systems_in_place,
      summary,
    });
    
    if (!validation.success) {
      console.error('[Atomic Sync] Training validation failed:', validation.errors);
      throw new Error(`Validation failed: ${JSON.stringify(validation.errors)}`);
    }
    
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Training data gathered:', {
        trainingId,
        organization: training.organization,
        relatedData: {
          delivery_approaches: delivery_approaches.length,
          operating_systems: operating_systems.length,
          immediate_attention: immediate_attention.length,
          verifiable_items: verifiable_items.length,
          systems_in_place: systems_in_place.length,
          hasSummary: !!summary,
        }
      });
    }
    
    // 3. Check for remote record status using RLS-bypassing RPC
    // This allows detecting soft-deleted records that regular users can't see via normal SELECT
    const recordStatus = await checkRemoteRecordStatus('trainings', trainingId);
    
    // SAFEGUARD: Check if remote record was soft-deleted by someone else
    // This works for ALL users (regular and super admin) by bypassing RLS
    if (recordStatus?.record_exists && recordStatus?.is_deleted) {
      console.warn('[Atomic Sync] Remote training was soft-deleted - cleaning up local copy:', trainingId);
      
      try {
        await deleteOfflineTraining(trainingId);
        console.log('[Atomic Sync] Cleaned up orphaned local training:', trainingId);
      } catch (cleanupError) {
        console.error('[Atomic Sync] Failed to clean up orphaned local training:', cleanupError);
      }
      
      return { 
        success: false, 
        skipped: true, 
        reason: 'remote_deleted',
        message: 'This training was deleted by an administrator. Local copy has been cleaned up.'
      };
    }
    
    // Use recordStatus for conflict detection if available
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      const remoteUpdated = new Date(recordStatus.updated_at!).getTime();
      const localUpdated = new Date(training.updated_at).getTime();
      const timeDiff = Math.abs(remoteUpdated - localUpdated);
      
      if (timeDiff > 5000 && remoteUpdated > localUpdated) {
        console.warn('[Atomic Sync] Training conflict detected:', trainingId);
        // For trainings, we use local-wins strategy silently
        // No toast notification - conflicts are resolved automatically
      }
    }
    
    // 4. Build transaction steps
    const steps: TransactionStep[] = [];
    
    // Exclude joined objects - only column fields exist in DB
    const { inspector, trainer, ...trainingWithoutJoin } = training as any;
    
    // For rollback, capture both synced_at and updated_at for proper state restoration
    const rollbackData = recordStatus?.record_exists 
      ? { synced_at: recordStatus.synced_at, updated_at: recordStatus.updated_at } 
      : null;
    
    // Step 1: Upsert training WITHOUT setting synced_at (defer to final step)
    // This ensures synced_at is only set after ALL related data is committed
    steps.push({
      table: 'trainings',
      operation: 'upsert',
      data: {
        ...trainingWithoutJoin,
        // DO NOT set synced_at here - it will be set in the final step
      },
      rollbackData,
    });
    
    // Step 2: Delete existing related data (to handle deletions)
    // Capture existing data for rollback safety before deletion
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      // Fetch existing related data for rollback
      const [
        existingApproaches,
        existingSystems,
        existingAttention,
        existingVerifiable,
        existingSystemsInPlace,
        existingSummary
      ] = await Promise.all([
        fetchRollbackData('training_delivery_approaches', { training_id: trainingId }),
        fetchRollbackData('training_operating_systems', { training_id: trainingId }),
        fetchRollbackData('training_immediate_attention', { training_id: trainingId }),
        fetchRollbackData('training_verifiable_items', { training_id: trainingId }),
        fetchRollbackData('training_systems_in_place', { training_id: trainingId }),
        fetchRollbackData('training_summary', { training_id: trainingId }),
      ]);
      
      steps.push(
        { table: 'training_delivery_approaches', operation: 'delete', filter: { training_id: trainingId }, rollbackData: existingApproaches },
        { table: 'training_operating_systems', operation: 'delete', filter: { training_id: trainingId }, rollbackData: existingSystems },
        { table: 'training_immediate_attention', operation: 'delete', filter: { training_id: trainingId }, rollbackData: existingAttention },
        { table: 'training_verifiable_items', operation: 'delete', filter: { training_id: trainingId }, rollbackData: existingVerifiable },
        { table: 'training_systems_in_place', operation: 'delete', filter: { training_id: trainingId }, rollbackData: existingSystemsInPlace },
        { table: 'training_summary', operation: 'delete', filter: { training_id: trainingId }, rollbackData: existingSummary }
      );
    }
    
    // Step 3: Insert all related data as BATCH operations (much faster on mobile)
    if (delivery_approaches.length > 0) {
      steps.push({
        table: 'training_delivery_approaches',
        operation: 'insert',
        data: delivery_approaches, // Batch insert all at once
      });
    }
    
    if (operating_systems.length > 0) {
      steps.push({
        table: 'training_operating_systems',
        operation: 'insert',
        data: operating_systems, // Batch insert all at once
      });
    }
    
    if (immediate_attention.length > 0) {
      steps.push({
        table: 'training_immediate_attention',
        operation: 'insert',
        data: immediate_attention, // Batch insert all at once
      });
    }
    
    if (verifiable_items.length > 0) {
      steps.push({
        table: 'training_verifiable_items',
        operation: 'insert',
        data: verifiable_items, // Batch insert all at once
      });
    }
    
    if (systems_in_place.length > 0) {
      steps.push({
        table: 'training_systems_in_place',
        operation: 'insert',
        data: systems_in_place, // Batch insert all at once
      });
    }
    
    if (summary) {
      // Sanitize summary before sync
      const sanitizedSummary = {
        ...summary,
        submission_date: summary.submission_date === "" ? null : summary.submission_date
      };
      
      steps.push({
        table: 'training_summary',
        operation: 'insert',
        data: [sanitizedSummary], // Wrap in array for consistency
      });
    }
    
    // FINAL STEP: Set synced_at ONLY after all related data is successfully inserted
    // This is the atomic guarantee - synced_at only updates when everything commits
    steps.push({
      table: 'trainings',
      operation: 'update',
      data: { synced_at: new Date().toISOString() },
      filter: { id: trainingId },
    });
    
    // 5. Execute transaction
    const result = await executeTransaction(steps);
    
    if (!result.success) {
      throw new Error(`Transaction failed after ${result.completedSteps}/${result.totalSteps} steps. Rollback: ${result.rollbackSuccess ? 'successful' : 'failed'}`);
    }
    
    // 6. Get cached inspector profile to attach to offline data
    const inspectorProfile = await getCachedProfile(user.id);
    
    // Update local storage with sync timestamp and inspector profile
    await saveTrainingOffline({
      ...training,
      synced_at: new Date().toISOString(),
      inspector: inspectorProfile || { first_name: null, last_name: null, avatar_url: null },
    });
    
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Successfully synced training with related data:', {
        trainingId,
        stepsCompleted: result.completedSteps,
        totalSteps: result.totalSteps,
      });
    }
    
    return { success: true };
    
  } catch (error: any) {
    console.error('[Atomic Sync] Failed to sync training:', trainingId, error);
    throw error;
  }
}

/**
 * Sync all unsynced trainings atomically
 */
export async function syncAllTrainingsAtomic() {
  const capabilities = getMobileCapabilities();
  const ITEM_SYNC_TIMEOUT = 25000; // 25 seconds per item max (increased for mobile networks)
  
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Offline - skipping training sync');
    }
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  // CRITICAL: Validate session before sync to ensure valid JWT for RLS
  let user;
  try {
    user = await Promise.race([
      ensureValidSession(),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 5000))
    ]);
  } catch (e) {
    console.warn('[Atomic Sync] Session validation timed out for trainings, skipping');
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  if (!user) {
    console.warn('[Atomic Sync] No valid session for training sync');
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  // Get unsynced trainings with extended timeout for mobile networks
  // Increased to 15s to avoid racing with inner 5s timeout + 3s health check
  let unsynced: any[];
  let fetchTimedOut = false;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('IndexedDB timeout')), 15000)
    );
    
    unsynced = await Promise.race([
      getUnsyncedTrainings(user.id),
      timeoutPromise
    ]);
  } catch (e: any) {
    if (e.message === 'IndexedDB timeout') {
      console.warn('[Atomic Sync] IndexedDB timeout getting unsynced trainings - will retry next cycle');
      fetchTimedOut = true;
    } else {
      console.warn('[Atomic Sync] Failed to get unsynced trainings:', e);
    }
    unsynced = [];
  }
  
  // Don't report success if we failed to fetch data (total: -1 signals fetch failure)
  if (fetchTimedOut) {
    return { total: -1, success: 0, failed: 0, errors: [{ id: 'indexeddb', error: 'Timeout fetching trainings' }] };
  }
  
  if (unsynced.length === 0) {
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] No trainings to sync');
    }
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  if (import.meta.env.DEV) {
    console.log('[Atomic Sync] Starting sync for all unsynced trainings', {
      count: unsynced.length,
      platform: capabilities.isIOS ? 'iOS' : capabilities.isAndroid ? 'Android' : 'Desktop',
    });
  }
  
  // Emit initial progress
  syncProgressEmitter.emit({
    total: unsynced.length,
    current: 0,
    currentItem: 'Starting training sync...',
    phase: 'trainings',
    errors: [],
  });
  
  let successCount = 0;
  let failCount = 0;
  const errors: Array<{ id: string; error: string }> = [];
  
  // Reduced retries for faster recovery
  const maxRetries = capabilities.isMobile ? 2 : 1;
  
  for (let i = 0; i < unsynced.length; i++) {
    const training = unsynced[i];
    let retryCount = 0;
    let synced = false;
    
    while (retryCount < maxRetries && !synced) {
      // Emit progress for current item
      syncProgressEmitter.emit({
        total: unsynced.length,
        current: i + 1,
        currentItem: `${training.organization}${retryCount > 0 ? ` (retry ${retryCount})` : ''}`,
        phase: 'trainings',
        errors,
      });
      
      try {
        // Per-item timeout
        await Promise.race([
          syncTrainingAtomic(training.id),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Item sync timeout')), ITEM_SYNC_TIMEOUT))
        ]);
        successCount++;
        synced = true;
        
        if (import.meta.env.DEV) {
          console.log(`[Atomic Sync] Synced training ${i + 1}/${unsynced.length}:`, training.id);
        }
      } catch (error: any) {
        retryCount++;
        
        if (retryCount < maxRetries) {
          const delay = Math.min(500 * retryCount, 2000);
          if (import.meta.env.DEV) {
            console.log(`[Atomic Sync] Retry ${retryCount}/${maxRetries} for training ${training.id} after ${delay}ms`);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          failCount++;
          errors.push({ id: training.id, error: error.message });
          console.error('[Atomic Sync] Failed to sync training after retries:', training.id, error);
        }
      }
    }
  }
  
  if (import.meta.env.DEV) {
    console.log('[Atomic Sync] Training sync results:', {
      total: unsynced.length,
      success: successCount,
      failed: failCount,
    });
  }
  
  return {
    total: unsynced.length,
    success: successCount,
    failed: failCount,
    errors,
  };
}

/**
 * Sync daily assessment with all related data atomically
 */
export async function syncDailyAssessmentAtomic(assessmentId: string) {
  if (!navigator.onLine) {
    throw new Error("Cannot sync while offline");
  }
  
  try {
    // 1. Gather all data for this assessment
    const assessment = await getOfflineDailyAssessment(assessmentId);
    if (!assessment) {
      throw new Error("Daily assessment not found in local storage");
    }
    
    // CRITICAL: Ensure we have a valid JWT before any database operations
    // This prevents RLS failures due to expired tokens on mobile
    const user = await ensureValidSession();
    if (!user) {
      console.error('[Atomic Sync] No valid session - sync aborted for assessment:', assessmentId);
      return { success: false, skipped: true, reason: 'invalid_session' };
    }
    
    // Skip assessments that don't belong to current user
    if (assessment.inspector_id !== user.id) {
      if (import.meta.env.DEV) {
        console.log('[Atomic Sync] Skipping assessment - belongs to different user', {
          assessment_id: assessmentId,
        });
      }
      return { success: false, skipped: true, reason: 'ownership_mismatch' };
    }
    
    const [rawBeginningOfDay, rawEndOfDay, rawOperatingSystems, rawEquipmentChecks, rawStructureChecks, rawEnvironmentChecks] = await Promise.all([
      getAssessmentDataOffline('beginning_of_day', assessmentId),
      getAssessmentDataOffline('end_of_day', assessmentId),
      getAssessmentDataOffline('operating_systems', assessmentId),
      getAssessmentDataOffline('equipment_checks', assessmentId),
      getAssessmentDataOffline('structure_checks', assessmentId),
      getAssessmentDataOffline('environment_checks', assessmentId),
    ]);
    
    // Transform temp- IDs to valid UUIDs before validation
    const beginning_of_day = transformTempIds(rawBeginningOfDay);
    const end_of_day = transformTempIds(rawEndOfDay);
    const operating_systems = transformTempIds(rawOperatingSystems);
    const equipment_checks = transformTempIds(rawEquipmentChecks);
    const structure_checks = transformTempIds(rawStructureChecks);
    const environment_checks = transformTempIds(rawEnvironmentChecks);
    
    // 2. Validate the complete package
    const validation = validateDailyAssessmentPackage({
      assessment,
      beginning_of_day,
      end_of_day,
      operating_systems,
      equipment_checks,
      structure_checks,
      environment_checks,
    });
    
    if (!validation.success) {
      console.error('[Atomic Sync] Daily assessment validation failed:', validation.errors);
      throw new Error(`Validation failed: ${JSON.stringify(validation.errors)}`);
    }
    
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Daily assessment data gathered:', {
        assessmentId,
        organization: assessment.organization,
        relatedData: {
          beginning_of_day: beginning_of_day.length,
          end_of_day: end_of_day.length,
          operating_systems: operating_systems.length,
          equipment_checks: equipment_checks.length,
          structure_checks: structure_checks.length,
          environment_checks: environment_checks.length,
        }
      });
    }
    
    // 3. Check for remote record status using RLS-bypassing RPC
    // This allows detecting soft-deleted records that regular users can't see via normal SELECT
    const recordStatus = await checkRemoteRecordStatus('daily_assessments', assessmentId);
    
    // SAFEGUARD: Check if remote record was soft-deleted by someone else
    // This works for ALL users (regular and super admin) by bypassing RLS
    if (recordStatus?.record_exists && recordStatus?.is_deleted) {
      console.warn('[Atomic Sync] Remote assessment was soft-deleted - cleaning up local copy:', assessmentId);
      
      try {
        await deleteOfflineDailyAssessment(assessmentId);
        console.log('[Atomic Sync] Cleaned up orphaned local assessment:', assessmentId);
      } catch (cleanupError) {
        console.error('[Atomic Sync] Failed to clean up orphaned local assessment:', cleanupError);
      }
      
      return { 
        success: false, 
        skipped: true, 
        reason: 'remote_deleted',
        message: 'This assessment was deleted by an administrator. Local copy has been cleaned up.'
      };
    }
    
    // Use recordStatus for conflict detection if available
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      const remoteUpdated = new Date(recordStatus.updated_at!).getTime();
      const localUpdated = new Date(assessment.updated_at).getTime();
      const timeDiff = Math.abs(remoteUpdated - localUpdated);
      
      if (timeDiff > 5000 && remoteUpdated > localUpdated) {
        console.warn('[Atomic Sync] Daily assessment conflict detected:', assessmentId);
        // For daily assessments, we use local-wins strategy silently
        // No toast notification - conflicts are resolved automatically
      }
    }
    
    // 4. Build transaction steps
    const steps: TransactionStep[] = [];
    
    // Exclude joined objects - only column fields exist in DB
    const { inspector, ...assessmentWithoutJoin } = assessment as any;
    
    // For rollback, capture both synced_at and updated_at for proper state restoration
    const rollbackData = recordStatus?.record_exists 
      ? { synced_at: recordStatus.synced_at, updated_at: recordStatus.updated_at } 
      : null;
    
    // Step 1: Upsert assessment WITHOUT setting synced_at (defer to final step)
    // This ensures synced_at is only set after ALL related data is committed
    steps.push({
      table: 'daily_assessments',
      operation: 'upsert',
      data: {
        ...assessmentWithoutJoin,
        // DO NOT set synced_at here - it will be set in the final step
      },
      rollbackData,
    });
    
    // Step 2: Delete existing related data (to handle deletions)
    // Capture existing data for rollback safety before deletion
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      // Fetch existing related data for rollback
      const [
        existingBeginning,
        existingEnd,
        existingSystems,
        existingEquipment,
        existingStructure,
        existingEnvironment
      ] = await Promise.all([
        fetchRollbackData('daily_assessment_beginning_of_day', { assessment_id: assessmentId }),
        fetchRollbackData('daily_assessment_end_of_day', { assessment_id: assessmentId }),
        fetchRollbackData('daily_assessment_operating_systems', { assessment_id: assessmentId }),
        fetchRollbackData('daily_assessment_equipment_checks', { assessment_id: assessmentId }),
        fetchRollbackData('daily_assessment_structure_checks', { assessment_id: assessmentId }),
        fetchRollbackData('daily_assessment_environment_checks', { assessment_id: assessmentId }),
      ]);
      
      steps.push(
        { table: 'daily_assessment_beginning_of_day', operation: 'delete', filter: { assessment_id: assessmentId }, rollbackData: existingBeginning },
        { table: 'daily_assessment_end_of_day', operation: 'delete', filter: { assessment_id: assessmentId }, rollbackData: existingEnd },
        { table: 'daily_assessment_operating_systems', operation: 'delete', filter: { assessment_id: assessmentId }, rollbackData: existingSystems },
        { table: 'daily_assessment_equipment_checks', operation: 'delete', filter: { assessment_id: assessmentId }, rollbackData: existingEquipment },
        { table: 'daily_assessment_structure_checks', operation: 'delete', filter: { assessment_id: assessmentId }, rollbackData: existingStructure },
        { table: 'daily_assessment_environment_checks', operation: 'delete', filter: { assessment_id: assessmentId }, rollbackData: existingEnvironment }
      );
    }
    
    // Step 3: Insert all related data as BATCH operations (much faster on mobile)
    if (beginning_of_day.length > 0) {
      steps.push({
        table: 'daily_assessment_beginning_of_day',
        operation: 'insert',
        data: beginning_of_day, // Batch insert all at once
      });
    }
    
    if (end_of_day.length > 0) {
      steps.push({
        table: 'daily_assessment_end_of_day',
        operation: 'insert',
        data: end_of_day, // Batch insert all at once
      });
    }
    
    if (operating_systems.length > 0) {
      steps.push({
        table: 'daily_assessment_operating_systems',
        operation: 'insert',
        data: operating_systems, // Batch insert all at once
      });
    }
    
    if (equipment_checks.length > 0) {
      steps.push({
        table: 'daily_assessment_equipment_checks',
        operation: 'insert',
        data: equipment_checks, // Batch insert all at once
      });
    }
    
    if (structure_checks.length > 0) {
      steps.push({
        table: 'daily_assessment_structure_checks',
        operation: 'insert',
        data: structure_checks, // Batch insert all at once
      });
    }
    
    if (environment_checks.length > 0) {
      steps.push({
        table: 'daily_assessment_environment_checks',
        operation: 'insert',
        data: environment_checks, // Batch insert all at once
      });
    }
    
    // FINAL STEP: Set synced_at ONLY after all related data is successfully inserted
    // This is the atomic guarantee - synced_at only updates when everything commits
    steps.push({
      table: 'daily_assessments',
      operation: 'update',
      data: { synced_at: new Date().toISOString() },
      filter: { id: assessmentId },
    });
    
    // 5. Execute transaction
    const result = await executeTransaction(steps);
    
    if (!result.success) {
      throw new Error(`Transaction failed after ${result.completedSteps}/${result.totalSteps} steps. Rollback: ${result.rollbackSuccess ? 'successful' : 'failed'}`);
    }
    
    // 6. Get cached inspector profile to attach to offline data
    const inspectorProfile = await getCachedProfile(user.id);
    
    // Update local storage with sync timestamp and inspector profile
    await saveDailyAssessmentOffline({
      ...assessment,
      synced_at: new Date().toISOString(),
      inspector: inspectorProfile || { first_name: null, last_name: null, avatar_url: null },
    });
    
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Successfully synced daily assessment with related data:', {
        assessmentId,
        stepsCompleted: result.completedSteps,
        totalSteps: result.totalSteps,
      });
    }
    
    return { success: true };
    
  } catch (error: any) {
    console.error('[Atomic Sync] Failed to sync daily assessment:', assessmentId, error);
    throw error;
  }
}

/**
 * Sync all unsynced daily assessments atomically
 */
export async function syncAllDailyAssessmentsAtomic() {
  const capabilities = getMobileCapabilities();
  const ITEM_SYNC_TIMEOUT = 25000; // 25 seconds per item max (increased for mobile networks)
  
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Offline - skipping daily assessment sync');
    }
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  // CRITICAL: Validate session before sync to ensure valid JWT for RLS
  let user;
  try {
    user = await Promise.race([
      ensureValidSession(),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 5000))
    ]);
  } catch (e) {
    console.warn('[Atomic Sync] Session validation timed out for assessments, skipping');
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  if (!user) {
    console.warn('[Atomic Sync] No valid session for assessment sync');
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  // Get unsynced assessments with extended timeout for mobile networks
  // Increased to 15s to avoid racing with inner 5s timeout + 3s health check
  let unsynced: any[];
  let fetchTimedOut = false;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('IndexedDB timeout')), 15000)
    );
    
    unsynced = await Promise.race([
      getUnsyncedDailyAssessments(user.id),
      timeoutPromise
    ]);
  } catch (e: any) {
    if (e.message === 'IndexedDB timeout') {
      console.warn('[Atomic Sync] IndexedDB timeout getting unsynced assessments - will retry next cycle');
      fetchTimedOut = true;
    } else {
      console.warn('[Atomic Sync] Failed to get unsynced assessments:', e);
    }
    unsynced = [];
  }
  
  // Don't report success if we failed to fetch data (total: -1 signals fetch failure)
  if (fetchTimedOut) {
    return { total: -1, success: 0, failed: 0, errors: [{ id: 'indexeddb', error: 'Timeout fetching assessments' }] };
  }
  
  if (unsynced.length === 0) {
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] No daily assessments to sync');
    }
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  if (import.meta.env.DEV) {
    console.log('[Atomic Sync] Starting sync for all unsynced daily assessments', {
      count: unsynced.length,
      platform: capabilities.isIOS ? 'iOS' : capabilities.isAndroid ? 'Android' : 'Desktop',
    });
  }
  
  // Emit initial progress
  syncProgressEmitter.emit({
    total: unsynced.length,
    current: 0,
    currentItem: 'Starting daily assessment sync...',
    phase: 'assessments',
    errors: [],
  });
  
  let successCount = 0;
  let failCount = 0;
  const errors: Array<{ id: string; error: string }> = [];
  
  // Reduced retries for faster recovery
  const maxRetries = capabilities.isMobile ? 2 : 1;
  
  for (let i = 0; i < unsynced.length; i++) {
    const assessment = unsynced[i];
    let retryCount = 0;
    let synced = false;
    
    while (retryCount < maxRetries && !synced) {
      // Emit progress for current item
      syncProgressEmitter.emit({
        total: unsynced.length,
        current: i + 1,
        currentItem: `${assessment.organization} - ${assessment.site}${retryCount > 0 ? ` (retry ${retryCount})` : ''}`,
        phase: 'assessments',
        errors,
      });
      
      try {
        // Per-item timeout
        await Promise.race([
          syncDailyAssessmentAtomic(assessment.id),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Item sync timeout')), ITEM_SYNC_TIMEOUT))
        ]);
        successCount++;
        synced = true;
        
        if (import.meta.env.DEV) {
          console.log(`[Atomic Sync] Synced daily assessment ${i + 1}/${unsynced.length}:`, assessment.id);
        }
      } catch (error: any) {
        retryCount++;
        
        if (retryCount < maxRetries) {
          const delay = Math.min(500 * retryCount, 2000);
          if (import.meta.env.DEV) {
            console.log(`[Atomic Sync] Retry ${retryCount}/${maxRetries} for assessment ${assessment.id} after ${delay}ms`);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          failCount++;
          errors.push({ id: assessment.id, error: error.message });
          console.error('[Atomic Sync] Failed to sync daily assessment after retries:', assessment.id, error);
        }
      }
    }
  }
  
  if (import.meta.env.DEV) {
    console.log('[Atomic Sync] Daily assessment sync results:', {
      total: unsynced.length,
      success: successCount,
      failed: failCount,
    });
  }
  
  return {
    total: unsynced.length,
    success: successCount,
    failed: failCount,
    errors,
  };
}
