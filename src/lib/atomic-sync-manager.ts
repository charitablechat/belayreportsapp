import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache, ensureValidSession, type CachedUser } from "@/lib/cached-auth";
import { 
  getUnsyncedInspections,
  saveInspectionOffline,
  getOfflineInspection,
  getRelatedDataOffline,
  getRelatedDataOfflineWithStatus,
  saveRelatedDataOffline,
  clearRelatedDataOffline,
  getUnsyncedTrainings,
  saveTrainingOffline,
  getOfflineTraining,
  getTrainingDataOffline,
  getTrainingDataOfflineWithStatus,
  saveTrainingDataOffline,
  getUnsyncedDailyAssessments,
  saveDailyAssessmentOffline,
  getOfflineDailyAssessment,
  getAssessmentDataOffline,
  getAssessmentDataOfflineWithStatus,
  saveAssessmentDataOffline,
  relinkPhotosToNewInspectionId,
  clearTrainingDataOffline,
  clearAssessmentDataOffline,
  getQueuedTrainingOperations,
  removeQueuedTrainingOperation,
  getQueuedOperations,
  removeQueuedOperation,
  getQueuedAssessmentOperations,
  removeQueuedAssessmentOperation,
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
import { reconcileAllChildTables } from "./sync-reconciliation";
import { syncProgressEmitter } from "@/hooks/useSyncProgress";
import { getMobileCapabilities } from "./mobile-detection";
import { getCachedProfile } from "./profile-cache";
import {
  deleteOfflineInspection,
  deleteOfflineTraining,
  deleteOfflineDailyAssessment,
} from "./offline-storage";
import { appendVersion, getLatestFieldCount, calculateFieldCount } from "./report-version-manager";
import { runWithConcurrency } from "./concurrency";
import { assertNoTempIds, assertNoTempIdsInArray } from "./sw-sync-validators";
import { registerSelfWrite } from "./sync-events";

/**
 * Maximum number of items to process per sync cycle.
 * Prevents timeout cascades when many items are queued (e.g., 22 reports).
 * Remaining items will be picked up in subsequent sync cycles.
 */
const MAX_BATCH_SIZE = 5;

/**
 * Tracks consecutive field_count_regression skips per record.
 * After MAX_REGRESSION_SKIPS consecutive skips, the guard allows sync to proceed.
 * This prevents legitimate large deletions from being blocked indefinitely.
 */
const regressionSkipCounter = new Map<string, number>();
const MAX_REGRESSION_SKIPS = 3;

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
export async function syncInspectionAtomic(inspectionId: string, preValidatedUser?: CachedUser) {
  if (!navigator.onLine) {
    throw new Error("Cannot sync while offline");
  }
  
  // Track temp-to-UUID mapping for post-sync IndexedDB cleanup
  let inspectionIdMapping: { oldId: string; newId: string } | null = null;
  
  try {
    // S9: Fetch inspection record + all child records in a single Promise.all batch.
    // Children are keyed by inspectionId which we already have, so no need to wait
    // for the parent record before kicking off child reads.
    const [
      inspectionRead,
      systemsRead,
      ziplinesRead,
      equipmentRead,
      standardsRead,
      summaryRead,
    ] = await Promise.all([
      getOfflineInspection(inspectionId),
      getRelatedDataOfflineWithStatus('systems', inspectionId),
      getRelatedDataOfflineWithStatus('ziplines', inspectionId),
      getRelatedDataOfflineWithStatus('equipment', inspectionId),
      getRelatedDataOfflineWithStatus('standards', inspectionId),
      getRelatedDataOfflineWithStatus('summary', inspectionId),
    ]);
    const inspection = inspectionRead;
    if (!inspection) {
      throw new Error("Inspection not found in local storage");
    }
    
    // Detect and replace temp inspection IDs with real UUIDs before validation
    if (inspection.id.startsWith('temp-')) {
      // S5: DEDUP via stable client_idempotency_key (server-enforced via partial unique index).
      // Falls back to deriving the key from the temp id for legacy temp records that
      // were created before this column existed.
      const idempKey = (inspection as any).client_idempotency_key
        ?? inspection.id.replace(/^temp-/, '');

      const { data: dupRows } = await supabase
        .from('inspections')
        .select('id')
        .eq('inspector_id', inspection.inspector_id)
        .eq('client_idempotency_key', idempKey)
        .limit(2);

      if (dupRows && dupRows.length > 0) {
        if (dupRows.length > 1) {
          console.warn('[Atomic Sync] Multiple server rows share idempotency key — adopting first, manual cleanup needed', {
            idempKey, ids: dupRows.map(r => r.id),
          });
        }
        const serverId = dupRows[0].id;
        console.log('[Atomic Sync] Found existing server record for temp inspection - adopting ID:', {
          tempId: inspection.id,
          serverId,
        });
        inspectionIdMapping = { oldId: inspection.id, newId: serverId };
        inspection.id = serverId;
        inspectionId = serverId;
      } else {
        const newId = crypto.randomUUID();
        inspectionIdMapping = { oldId: inspection.id, newId };
        console.log('[Atomic Sync] Replacing temp inspection ID with real UUID:', {
          oldId: inspection.id,
          newId,
        });
        inspection.id = newId;
        inspectionId = newId;
      }

      // Always carry the idempotency key forward into the upsert payload.
      (inspection as any).client_idempotency_key = idempKey;
    }
    
    // Use pre-validated user from batch caller, or validate session if called individually
    const user = preValidatedUser || await ensureValidSession();
    if (!user) {
      console.error('[Atomic Sync] No valid session - sync aborted for inspection:', inspectionId);
      // THROW instead of returning silently so caller counts this as a failure
      throw new Error('No valid session for sync');
    }
    
    // Auto-fix ownership for locally-created records, skip only for server-origin records
    if (inspection.inspector_id !== user.id) {
      if (!inspection.synced_at) {
        console.log('[Atomic Sync] Auto-fixing inspector_id for local inspection:', {
          inspectionId,
          oldInspectorId: inspection.inspector_id?.substring(0, 8),
          newInspectorId: user.id.substring(0, 8),
        });
        inspection.inspector_id = user.id;
        await saveInspectionOffline(inspection);
      } else {
        console.warn('[Atomic Sync] Skipping inspection - belongs to different user', {
          inspection_id: inspectionId,
        });
        return { success: false, skipped: true, reason: 'ownership_mismatch' };
      }
    }
    
    const rawSystems = systemsRead.items;
    const rawZiplines = ziplinesRead.items;
    const rawEquipment = equipmentRead.items;
    const rawStandards = standardsRead.items;
    const summaryArray = summaryRead.items;
    const idbReadFlags = {
      systems: systemsRead.readSucceeded,
      ziplines: ziplinesRead.readSucceeded,
      equipment: equipmentRead.readSucceeded,
      standards: standardsRead.readSucceeded,
      summary: summaryRead.readSucceeded,
    };
    
    let rawSummary = summaryArray[0] || null;
    
    // If we swapped the inspection ID, propagate new ID to all child records
    if (inspectionIdMapping) {
      const updateChildInspectionId = (items: any[]) =>
        items.map(item => ({
          ...item,
          inspection_id: inspectionIdMapping!.newId,
        }));
      
      rawSystems.forEach(item => item.inspection_id = inspectionIdMapping!.newId);
      rawZiplines.forEach(item => item.inspection_id = inspectionIdMapping!.newId);
      rawEquipment.forEach(item => item.inspection_id = inspectionIdMapping!.newId);
      rawStandards.forEach(item => item.inspection_id = inspectionIdMapping!.newId);
      if (rawSummary) {
        rawSummary = { ...rawSummary, inspection_id: inspectionIdMapping.newId };
      }
    }
    
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
    
    // RC-5: Skip remote status check for new records (no synced_at = never been on server)
    // This eliminates ~6 network requests per new record (status check + 5 rollback fetches)
    const isNewRecord = !inspection.synced_at;
    const recordStatus = isNewRecord ? null : await checkRemoteRecordStatus('inspections', inspectionId);
    
    // SAFEGUARD: Check if remote record was soft-deleted by someone else
    if (recordStatus?.record_exists && recordStatus?.is_deleted) {
      console.warn('[Atomic Sync] Remote record was soft-deleted - cleaning up local copy:', inspectionId);
      
      // PRE-DELETE BACKUP: Snapshot before destroying local data
      try {
        const localData = await getOfflineInspection(inspectionId);
        if (localData) {
          const [sys, zips, equip, stds, summ] = await Promise.all([
            getRelatedDataOffline('systems', inspectionId),
            getRelatedDataOffline('ziplines', inspectionId),
            getRelatedDataOffline('equipment', inspectionId),
            getRelatedDataOffline('standards', inspectionId),
            getRelatedDataOffline('summary', inspectionId),
          ]);
          appendVersion('inspection', inspectionId, localData, {
            systems: sys, ziplines: zips, equipment: equip, standards: stds, summary: summ,
          }, 'pre_delete').catch(() => {});
        }
      } catch (backupErr) {
        console.warn('[Atomic Sync] Pre-delete backup failed:', backupErr);
      }
      
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
    // PRE-SYNC VERSION SNAPSHOT — capture immutable state before sync
    appendVersion('inspection', inspectionId, inspection, {
      systems, ziplines, equipment, standards, summary: summary ? [summary] : [],
    }, 'pre_sync').catch(() => {});

    // FIELD-COUNT REGRESSION GUARD — block sync if local data regressed significantly
    const currentFieldCount = calculateFieldCount(inspection, {
      systems, ziplines, equipment, standards, summary: summary ? [summary] : [],
    });
    const previousFieldCount = await getLatestFieldCount(inspectionId);
    if (previousFieldCount !== null && previousFieldCount > 0) {
      const dropPercent = ((previousFieldCount - currentFieldCount) / previousFieldCount) * 100;
      if (dropPercent > 50) {
        const skipCount = (regressionSkipCounter.get(inspectionId) || 0) + 1;
        regressionSkipCounter.set(inspectionId, skipCount);
        if (skipCount <= MAX_REGRESSION_SKIPS) {
          console.error('[SAFETY] Blocked inspection sync: field count regression >50%', {
            inspectionId: inspectionId.substring(0, 8),
            previousFieldCount,
            currentFieldCount,
            dropPercent: dropPercent.toFixed(1),
            skipCount,
            maxSkips: MAX_REGRESSION_SKIPS,
          });
          return { success: false, skipped: true, reason: 'field_count_regression' };
        }
        console.warn('[SAFETY] Allowing inspection sync after max regression skips reached', {
          inspectionId: inspectionId.substring(0, 8),
          skipCount,
        });
        regressionSkipCounter.delete(inspectionId);
      } else {
        // Field count is healthy — clear any previous skip counter
        regressionSkipCounter.delete(inspectionId);
      }
    }

    // M15: Hard guard — fail loud if any temp- ID slipped past the transforms above.
    assertNoTempIds(inspection, 'inspections.upsert');
    assertNoTempIdsInArray(systems, 'inspection_systems.upsert');
    assertNoTempIdsInArray(ziplines, 'inspection_ziplines.upsert');
    assertNoTempIdsInArray(equipment, 'inspection_equipment.upsert');
    assertNoTempIdsInArray(standards, 'inspection_standards.upsert');
    if (summary) assertNoTempIds(summary, 'inspection_summary.upsert');

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
    
    // ZERO DATA LOSS: Empty-array safeguard
    // If the server has child data but local is completely empty, this is suspicious
    // (likely IndexedDB corruption or failed read) -- skip sync to prevent data loss
    let existingSystems: any[] = [];
    let existingZiplines: any[] = [];
    let existingEquipment: any[] = [];
    let existingStandards: any[] = [];
    let existingSummary: any[] = [];
    
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      [
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
      
      const serverHasChildData = existingSystems.length > 0 || existingZiplines.length > 0 || 
        existingEquipment.length > 0 || existingStandards.length > 0 || existingSummary.length > 0;
      const localIsCompletelyEmpty = systems.length === 0 && ziplines.length === 0 && 
        equipment.length === 0 && standards.length === 0 && !summary;
      
      if (serverHasChildData && localIsCompletelyEmpty) {
        console.warn('[SAFETY] empty_local_guard: server has child data but local is empty', {
          inspectionId,
          serverCounts: {
            systems: existingSystems.length,
            ziplines: existingZiplines.length,
            equipment: existingEquipment.length,
            standards: existingStandards.length,
            summary: existingSummary.length,
          },
        });
        
        // RECOVERY: If this record was previously synced, pull server data into local
        // cache and re-align timestamps to stop the infinite retry loop
        if (inspection.synced_at) {
          console.log('[SAFETY] Recovering: pulling server child data into local cache and re-aligning timestamps');
          try {
            await Promise.all([
              existingSystems.length > 0 ? saveRelatedDataOffline('systems', inspectionId, existingSystems) : Promise.resolve(),
              existingZiplines.length > 0 ? saveRelatedDataOffline('ziplines', inspectionId, existingZiplines) : Promise.resolve(),
              existingEquipment.length > 0 ? saveRelatedDataOffline('equipment', inspectionId, existingEquipment) : Promise.resolve(),
              existingStandards.length > 0 ? saveRelatedDataOffline('standards', inspectionId, existingStandards) : Promise.resolve(),
              existingSummary.length > 0 ? saveRelatedDataOffline('summary', inspectionId, existingSummary) : Promise.resolve(),
            ]);
            
            // Re-align local timestamps so it stops appearing as unsynced
            const alignedTimestamp = recordStatus.updated_at || new Date().toISOString();
            await saveInspectionOffline({
              ...inspection,
              synced_at: alignedTimestamp,
              updated_at: alignedTimestamp,
            });
            
            console.log('[SAFETY] Recovery complete: local cache restored from server, timestamps aligned');
          } catch (recoveryError) {
            console.error('[SAFETY] Recovery failed:', recoveryError);
          }
        }
        
        return { success: false, skipped: true, reason: 'empty_local_guard' };
      }
    }
    
    // SUSPICIOUS EMPTY GUARD: If record has been edited but ALL child data is empty,
    // this likely means IndexedDB reads failed silently. Skip sync to prevent marking as complete.
    // This complements the empty_local_guard above (which only fires when server already has data).
    {
      const localIsCompletelyEmpty = systems.length === 0 && ziplines.length === 0 && 
        equipment.length === 0 && standards.length === 0 && !summary;
      const createdAt = new Date(inspection.created_at || inspection.updated_at).getTime();
      const updatedAt = new Date(inspection.updated_at).getTime();
      const ageMinutes = (Date.now() - createdAt) / 60000;
      const wasEdited = (updatedAt - createdAt) > 60000; // edited if updated > 60s after creation

      if (localIsCompletelyEmpty && wasEdited && ageMinutes > 5) {
        if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
          // Guard 1 already ran and didn't block — server is also empty. Allow sync.
          console.log('[SYNC] suspicious_empty_guard: both local and server are empty, allowing sync for genuinely blank inspection', {
            inspectionId: inspectionId.substring(0, 8),
          });
        } else {
          // Record doesn't exist on server yet — new blank form, allow sync
          console.log('[SYNC] suspicious_empty_guard: new inspection with no server data, allowing sync', {
            inspectionId: inspectionId.substring(0, 8),
          });
        }
      }
    }

    // Step 2: RECONCILE then UPSERT child data
    // Delete server rows that were removed locally, then upsert current local data
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      const reconcileResult = await reconcileAllChildTables(
        [
          { childTable: 'inspection_systems', parentIdColumn: 'inspection_id', localItems: systems, prefetchedServerRows: existingSystems, expectedNonEmpty: idbReadFlags.systems },
          { childTable: 'inspection_ziplines', parentIdColumn: 'inspection_id', localItems: ziplines, prefetchedServerRows: existingZiplines, expectedNonEmpty: idbReadFlags.ziplines },
          { childTable: 'inspection_equipment', parentIdColumn: 'inspection_id', localItems: equipment, prefetchedServerRows: existingEquipment, expectedNonEmpty: idbReadFlags.equipment },
          { childTable: 'inspection_standards', parentIdColumn: 'inspection_id', localItems: standards, prefetchedServerRows: existingStandards, expectedNonEmpty: idbReadFlags.standards },
          { childTable: 'inspection_summary', parentIdColumn: 'inspection_id', localItems: summary ? [summary] : [], prefetchedServerRows: existingSummary, expectedNonEmpty: idbReadFlags.summary },
        ],
        inspectionId,
        'inspection',
        user.id,
      );
      // If any child table's reconcile was blocked by a safety guard, do NOT mark
      // the parent as synced — the user still has unflushed deletions to retry.
      if (reconcileResult.blocked) {
        console.warn('[Atomic Sync] Inspection reconcile blocked — marking sync as failed so user can retry', {
          inspectionId: inspectionId.substring(0, 8),
          blockedTables: reconcileResult.blockedTables,
        });
        return {
          success: false,
          skipped: true,
          reason: 'reconcile_blocked',
          message: 'Some local deletions could not be confirmed against the server. Will retry on next sync.',
        };
      }
    }

    if (systems.length > 0) {
      steps.push({
        table: 'inspection_systems',
        operation: 'upsert',
        data: systems,
      });
    }
    
    if (ziplines.length > 0) {
      steps.push({
        table: 'inspection_ziplines',
        operation: 'upsert',
        data: ziplines,
      });
    }
    
    if (equipment.length > 0) {
      steps.push({
        table: 'inspection_equipment',
        operation: 'upsert',
        data: equipment,
      });
    }
    
    if (standards.length > 0) {
      steps.push({
        table: 'inspection_standards',
        operation: 'upsert',
        data: standards,
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
        operation: 'upsert',
        data: [sanitizedSummary],
      });
    }
    
    // FINAL STEP: Set synced_at ONLY after all related data is successfully inserted
    // This is the atomic guarantee - synced_at only updates when everything commits
    steps.push({
      table: 'inspections',
      operation: 'update',
      data: { synced_at: new Date().toISOString(), last_sync_source: 'main_thread' },
      filter: { id: inspectionId },
    });
    
    // 5. Execute transaction
    // S6: register self-write so the Realtime handler doesn't re-trigger sync from our own writes
    registerSelfWrite(inspectionId);
    const result = await executeTransaction(steps);
    
    if (!result.success) {
      throw new Error(`Transaction failed after ${result.completedSteps}/${result.totalSteps} steps. Rollback: ${result.rollbackSuccess ? 'successful' : 'failed'}`);
    }
    
    // S4: Skip post-transaction verify SELECT — `executeTransaction` already throws on
    // 0-affected-row writes, and `align_synced_at` below errors loudly if the row is missing.
    
    // 6. Get cached inspector profile to attach to offline data
    const inspectorProfile = await getCachedProfile(user.id);
    
    // POST-SYNC ALIGNMENT: Call align_synced_at RPC to set synced_at = updated_at on server
    // The updated trigger now preserves updated_at for metadata-only changes,
    // and this RPC ensures synced_at >= updated_at, eliminating the re-sync race condition.
    const { data: aligned, error: alignError } = await supabase.rpc('align_synced_at', {
      p_table_name: 'inspections',
      p_record_id: inspectionId,
    });

    // S3: align_synced_at is ADVISORY. The transaction's final step already wrote
    // synced_at on the server (executeTransaction enforces row-count > 0). If the
    // RPC fails (network blip, lock, transient error), fall back to the timestamp
    // we just committed so local state advances and the record stops re-queueing.
    let serverTimestamp: string;
    const alignedData = aligned as any;
    if (alignError || !alignedData || alignedData.error) {
      console.warn(
        '[Atomic Sync] align_synced_at non-fatal failure — using transaction timestamp',
        { table: 'inspections', id: inspectionId, alignError: alignError?.message, aligned }
      );
      serverTimestamp = (steps[steps.length - 1].data as any).synced_at;
    } else {
      serverTimestamp = alignedData.updated_at;
      console.log(
        '%c[SYNC_TERMINAL] align_synced_at CONFIRMED %c%s',
        'color: #4ade80; font-family: monospace; font-weight: bold',
        'color: #86efac; font-family: monospace',
        `| table=inspections | id=${inspectionId.substring(0,8)}... | ts=${serverTimestamp}`
      );
    }
    
    await saveInspectionOffline({
      ...inspection,
      synced_at: serverTimestamp,
      updated_at: serverTimestamp,
      inspector: inspectorProfile || { first_name: null, last_name: null, avatar_url: null },
    });
    
    // 7. If we swapped a temp ID, clean up old IndexedDB entries
    if (inspectionIdMapping) {
      console.log('[Atomic Sync] Cleaning up old temp-ID entries from IndexedDB:', inspectionIdMapping.oldId);
      
      // Delete old inspection entry keyed by temp ID
      await deleteOfflineInspection(inspectionIdMapping.oldId);
      
      // Clean up child record stores that were keyed under the old temp inspection_id
      const childStores = ['systems', 'ziplines', 'equipment', 'standards', 'summary'] as const;
      for (const store of childStores) {
        await clearRelatedDataOffline(store, inspectionIdMapping.oldId);
      }
      
      // Save child records under the new UUID
      await Promise.all([
        systems.length > 0 ? saveRelatedDataOffline('systems', inspectionIdMapping.newId, systems) : Promise.resolve(),
        ziplines.length > 0 ? saveRelatedDataOffline('ziplines', inspectionIdMapping.newId, ziplines) : Promise.resolve(),
        equipment.length > 0 ? saveRelatedDataOffline('equipment', inspectionIdMapping.newId, equipment) : Promise.resolve(),
        standards.length > 0 ? saveRelatedDataOffline('standards', inspectionIdMapping.newId, standards) : Promise.resolve(),
        summary ? saveRelatedDataOffline('summary', inspectionIdMapping.newId, [summary]) : Promise.resolve(),
      ]);
      
      // Relink photos from temp ID to new UUID so syncPhotos() can upload them
      await relinkPhotosToNewInspectionId(inspectionIdMapping.oldId, inspectionIdMapping.newId);
    }
    
    // Clean up any queued operations entries for this inspection
    try {
      const queuedOps = await getQueuedOperations();
      const matchingOps = queuedOps.filter(op => {
        const opInspectionId = op.inspectionId || op.data?.id;
        return opInspectionId === inspectionId || (inspectionIdMapping && opInspectionId === inspectionIdMapping.oldId);
      });
      for (const op of matchingOps) {
        await removeQueuedOperation(op.id!);
      }
      if (matchingOps.length > 0 && import.meta.env.DEV) {
        console.log(`[Atomic Sync] Cleaned up ${matchingOps.length} orphaned operations entries for ${inspectionId}`);
      }
    } catch (cleanupErr) {
      console.warn('[Atomic Sync] Non-blocking: failed to clean operations queue:', cleanupErr);
    }
    
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
export async function syncAllInspectionsAtomic(preValidatedUser?: CachedUser) {
  const capabilities = getMobileCapabilities();
  const ITEM_SYNC_TIMEOUT = 25000; // 25 seconds per item max (increased for mobile networks)
  
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Offline - skipping sync');
    }
    return;
  }
  
  // Use pre-validated user if provided (avoids redundant LockManager calls)
  let user: CachedUser | null = preValidatedUser || null;
  if (!user) {
    // CRITICAL: Validate session before sync to ensure valid JWT for RLS
    try {
      user = await Promise.race([
        ensureValidSession(),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 8000))
      ]);
    } catch (e) {
      console.warn('[Atomic Sync] Session validation timed out, skipping sync');
      return { total: 0, success: 0, failed: 0, errors: [] };
    }
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
  
  // Early return for empty batch (consistent with trainings/assessments)
  if (unsynced.length === 0) {
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] No inspections to sync');
    }
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  // Batch limiting: only process MAX_BATCH_SIZE items per cycle
  const totalUnsynced = unsynced.length;
  const batch = unsynced.slice(0, MAX_BATCH_SIZE);
  const remaining = totalUnsynced - batch.length;
  
  // Log temp-ID items for sync debugging (always, not just DEV)
  const tempIdItems = batch.filter(i => i.id.startsWith('temp-'));
  if (tempIdItems.length > 0) {
    console.log('[Atomic Sync] Batch includes temp-ID inspections:', 
      tempIdItems.map(i => ({ id: i.id.substring(0, 20), org: i.organization }))
    );
  }
  
  if (import.meta.env.DEV) {
    console.log('[Atomic Sync] Starting sync for unsynced inspections', {
      total: totalUnsynced,
      batchSize: batch.length,
      remaining,
      platform: capabilities.isIOS ? 'iOS' : capabilities.isAndroid ? 'Android' : 'Desktop',
      browser: capabilities.browser,
      isPWA: capabilities.isPWA,
    });
  }
  
  // Emit initial progress
  syncProgressEmitter.emit({
    total: batch.length,
    current: 0,
    currentItem: `Starting sync... (${totalUnsynced} total pending)`,
    phase: 'inspections',
    errors: [],
  });
  
  let successCount = 0;
  let failCount = 0;
  const errors: Array<{ id: string; error: string }> = [];
  
  // Mobile devices get retry logic
  const maxRetries = capabilities.isMobile ? 2 : 1; // Reduced retries for faster recovery
  // S2: Bounded concurrency — different inspectionIds never share child rows, and
  // executeTransaction is per-record. 3 on mobile / 5 on desktop is well within Supabase
  // connection-pool headroom and dramatically reduces wall-clock for queued drains.
  const itemConcurrency = capabilities.isMobile ? 3 : 5;
  let progressCounter = 0;

  await runWithConcurrency(batch, itemConcurrency, async (inspection, i) => {
    let retryCount = 0;
    let synced = false;

    while (retryCount < maxRetries && !synced) {
      // Emit progress for current item
      progressCounter++;
      syncProgressEmitter.emit({
        total: batch.length,
        current: progressCounter,
        currentItem: `${inspection.organization} - ${inspection.location}${retryCount > 0 ? ` (retry ${retryCount})` : ''}${remaining > 0 ? ` (${remaining} more queued)` : ''}`,
        phase: 'inspections',
        errors,
      });

      try {
        // Per-item timeout to prevent single item from blocking entire sync
        // Pass pre-validated user to skip redundant session validation per item
        const itemResult = await Promise.race([
          syncInspectionAtomic(inspection.id, user as CachedUser),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Item sync timeout')), ITEM_SYNC_TIMEOUT))
        ]);
        // Only count as success if item was actually synced (not skipped)
        if (itemResult && typeof itemResult === 'object' && (itemResult as any).skipped) {
          // Skipped items don't count as success or failure
          if (import.meta.env.DEV) {
            console.log(`[Atomic Sync] Skipped ${i + 1}/${unsynced.length}:`, inspection.id, (itemResult as any).reason);
          }
          synced = true; // Don't retry skipped items
        } else {
          successCount++;
          synced = true;
        }

        if (import.meta.env.DEV) {
          console.log(`[Atomic Sync] Synced ${i + 1}/${batch.length} (${remaining} remaining):`, inspection.id);
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
  });
  
  // Emit completion
  syncProgressEmitter.emit({
    total: batch.length,
    current: batch.length,
    currentItem: remaining > 0 ? `Batch complete (${remaining} more queued)` : 'Sync complete',
    phase: 'complete',
    errors,
  });
  
  // Log results (always, not just DEV - critical for mobile production diagnostics)
  console.log('[Atomic Sync] Inspection sync results:', {
    batch: batch.length,
    totalPending: totalUnsynced,
    remaining,
    success: successCount,
    failed: failCount,
  });
  if (failCount > 0) {
    console.error('[Atomic Sync] Errors:', errors);
  }
  
  return {
    total: totalUnsynced,
    success: successCount,
    failed: failCount,
    remaining,
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
export async function syncTrainingAtomic(trainingId: string, preValidatedUser?: CachedUser) {
  if (!navigator.onLine) {
    throw new Error("Cannot sync while offline");
  }
  
  // Track temp-to-UUID mapping for post-sync IndexedDB cleanup
  let trainingIdMapping: { oldId: string; newId: string } | null = null;
  
  try {
    // 1. Gather all data for this training
    const training = await getOfflineTraining(trainingId);
    if (!training) {
      throw new Error("Training not found in local storage");
    }
    
    // Detect and replace temp training IDs with real UUIDs before validation
    if (training.id.startsWith('temp-')) {
      // S5: DEDUP via stable client_idempotency_key (server-enforced via partial unique index).
      const idempKey = (training as any).client_idempotency_key
        ?? training.id.replace(/^temp-/, '');

      const { data: dupRows } = await supabase
        .from('trainings')
        .select('id')
        .eq('inspector_id', training.inspector_id)
        .eq('client_idempotency_key', idempKey)
        .limit(2);

      if (dupRows && dupRows.length > 0) {
        if (dupRows.length > 1) {
          console.warn('[Atomic Sync] Multiple server rows share idempotency key — adopting first, manual cleanup needed', {
            idempKey, ids: dupRows.map(r => r.id),
          });
        }
        const serverId = dupRows[0].id;
        console.log('[Atomic Sync] Found existing server record for temp training - adopting ID:', {
          tempId: training.id,
          serverId,
        });
        trainingIdMapping = { oldId: training.id, newId: serverId };
        training.id = serverId;
        trainingId = serverId;
      } else {
        const newId = crypto.randomUUID();
        trainingIdMapping = { oldId: training.id, newId };
        console.log('[Atomic Sync] Replacing temp training ID with real UUID:', {
          oldId: training.id,
          newId,
        });
        training.id = newId;
        trainingId = newId;
      }

      (training as any).client_idempotency_key = idempKey;
    }
    
    // Use pre-validated user from batch caller, or validate session if called individually
    const user = preValidatedUser || await ensureValidSession();
    if (!user) {
      console.error('[Atomic Sync] No valid session - sync aborted for training:', trainingId);
      throw new Error('No valid session for sync');
    }
    
    // Auto-fix ownership for locally-created records, skip only for server-origin records
    if (training.inspector_id !== user.id) {
      if (!training.synced_at) {
        console.log('[Atomic Sync] Auto-fixing inspector_id for local training:', {
          trainingId,
          oldInspectorId: training.inspector_id?.substring(0, 8),
          newInspectorId: user.id.substring(0, 8),
        });
        training.inspector_id = user.id;
        await saveTrainingOffline(training);
      } else {
        console.warn('[Atomic Sync] Skipping training - belongs to different user', {
          training_id: trainingId,
        });
        return { success: false, skipped: true, reason: 'ownership_mismatch' };
      }
    }
    
    // Fetch child records using the ORIGINAL ID (before temp-to-UUID swap)
    // because they are stored in IndexedDB under the original training_id
    const fetchId = trainingIdMapping ? trainingIdMapping.oldId : trainingId;
    
    const [daRead, osRead, iaRead, viRead, sipRead, summaryReadT] = await Promise.all([
      getTrainingDataOfflineWithStatus('delivery_approaches', fetchId),
      getTrainingDataOfflineWithStatus('operating_systems', fetchId),
      getTrainingDataOfflineWithStatus('immediate_attention', fetchId),
      getTrainingDataOfflineWithStatus('verifiable_items', fetchId),
      getTrainingDataOfflineWithStatus('systems_in_place', fetchId),
      getTrainingDataOfflineWithStatus('summary', fetchId),
    ]);
    const rawDeliveryApproaches = daRead.items;
    const rawOperatingSystems = osRead.items;
    const rawImmediateAttention = iaRead.items;
    const rawVerifiableItems = viRead.items;
    const rawSystemsInPlace = sipRead.items;
    const summaryArray = summaryReadT.items;
    const trainingIdbReadFlags = {
      delivery_approaches: daRead.readSucceeded,
      operating_systems: osRead.readSucceeded,
      immediate_attention: iaRead.readSucceeded,
      verifiable_items: viRead.readSucceeded,
      systems_in_place: sipRead.readSucceeded,
      summary: summaryReadT.readSucceeded,
    };
    
    let rawSummary = summaryArray[0] || null;
    
    // If we swapped the training ID, propagate new ID to all child records
    if (trainingIdMapping) {
      rawDeliveryApproaches.forEach(item => item.training_id = trainingIdMapping!.newId);
      rawOperatingSystems.forEach(item => item.training_id = trainingIdMapping!.newId);
      rawImmediateAttention.forEach(item => item.training_id = trainingIdMapping!.newId);
      rawVerifiableItems.forEach(item => item.training_id = trainingIdMapping!.newId);
      rawSystemsInPlace.forEach(item => item.training_id = trainingIdMapping!.newId);
      if (rawSummary) {
        rawSummary = { ...rawSummary, training_id: trainingIdMapping.newId };
      }
    }
    
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
    
    // RC-5: Skip remote status check for new records (never synced = never on server)
    const isNewTraining = !training.synced_at;
    const recordStatus = isNewTraining ? null : await checkRemoteRecordStatus('trainings', trainingId);
    
    // SAFEGUARD: Check if remote record was soft-deleted by someone else
    // This works for ALL users (regular and super admin) by bypassing RLS
    if (recordStatus?.record_exists && recordStatus?.is_deleted) {
      console.warn('[Atomic Sync] Remote training was soft-deleted - cleaning up local copy:', trainingId);
      
      // PRE-DELETE BACKUP: Snapshot before destroying local data
      try {
        const localData = await getOfflineTraining(trainingId);
        if (localData) {
          const [da, os, ia, vi, sip, summ] = await Promise.all([
            getTrainingDataOffline('delivery_approaches', trainingId),
            getTrainingDataOffline('operating_systems', trainingId),
            getTrainingDataOffline('immediate_attention', trainingId),
            getTrainingDataOffline('verifiable_items', trainingId),
            getTrainingDataOffline('systems_in_place', trainingId),
            getTrainingDataOffline('summary', trainingId),
          ]);
          appendVersion('training', trainingId, localData, {
            delivery_approaches: da, operating_systems: os, immediate_attention: ia,
            verifiable_items: vi, systems_in_place: sip, summary: summ,
          }, 'pre_delete').catch(() => {});
        }
      } catch (backupErr) {
        console.warn('[Atomic Sync] Pre-delete training backup failed:', backupErr);
      }
      
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
    
    // PRE-SYNC VERSION SNAPSHOT — capture immutable state before sync
    appendVersion('training', trainingId, training, {
      delivery_approaches, operating_systems, immediate_attention,
      verifiable_items, systems_in_place, summary: summary ? [summary] : [],
    }, 'pre_sync').catch(() => {});

    // FIELD-COUNT REGRESSION GUARD — block sync if local data regressed significantly
    const currentFieldCount = calculateFieldCount(training, {
      delivery_approaches, operating_systems, immediate_attention,
      verifiable_items, systems_in_place, summary: summary ? [summary] : [],
    });
    const previousFieldCount = await getLatestFieldCount(trainingId);
    if (previousFieldCount !== null && previousFieldCount > 0) {
      const dropPercent = ((previousFieldCount - currentFieldCount) / previousFieldCount) * 100;
      if (dropPercent > 50) {
        const skipCount = (regressionSkipCounter.get(trainingId) || 0) + 1;
        regressionSkipCounter.set(trainingId, skipCount);
        if (skipCount <= MAX_REGRESSION_SKIPS) {
          console.error('[SAFETY] Blocked training sync: field count regression >50%', {
            trainingId: trainingId.substring(0, 8),
            previousFieldCount,
            currentFieldCount,
            dropPercent: dropPercent.toFixed(1),
            skipCount,
            maxSkips: MAX_REGRESSION_SKIPS,
          });
          return { success: false, skipped: true, reason: 'field_count_regression' };
        }
        console.warn('[SAFETY] Allowing training sync after max regression skips reached', {
          trainingId: trainingId.substring(0, 8),
          skipCount,
        });
        regressionSkipCounter.delete(trainingId);
      } else {
        regressionSkipCounter.delete(trainingId);
      }
    }

    // M15: Hard guard — fail loud if any temp- ID slipped past the transforms above.
    assertNoTempIds(training, 'trainings.upsert');
    assertNoTempIdsInArray(delivery_approaches, 'training_delivery_approaches.upsert');
    assertNoTempIdsInArray(operating_systems, 'training_operating_systems.upsert');
    assertNoTempIdsInArray(immediate_attention, 'training_immediate_attention.upsert');
    assertNoTempIdsInArray(verifiable_items, 'training_verifiable_items.upsert');
    assertNoTempIdsInArray(systems_in_place, 'training_systems_in_place.upsert');
    if (summary) assertNoTempIds(summary, 'training_summary.upsert');

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
    
    let existingApproaches: any[] = [];
    let existingSystems: any[] = [];
    let existingAttention: any[] = [];
    let existingVerifiable: any[] = [];
    let existingSystemsInPlace: any[] = [];
    let existingSummary: any[] = [];
    
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      [
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
      
      const serverHasChildData = existingApproaches.length > 0 || existingSystems.length > 0 || 
        existingAttention.length > 0 || existingVerifiable.length > 0 || 
        existingSystemsInPlace.length > 0 || existingSummary.length > 0;
      const localIsCompletelyEmpty = delivery_approaches.length === 0 && operating_systems.length === 0 && 
        immediate_attention.length === 0 && verifiable_items.length === 0 && 
        systems_in_place.length === 0 && !summary;
      
      if (serverHasChildData && localIsCompletelyEmpty) {
        console.warn('[SAFETY] empty_local_guard: training server has child data but local is empty', {
          trainingId,
          serverCounts: {
            approaches: existingApproaches.length,
            systems: existingSystems.length,
            attention: existingAttention.length,
            verifiable: existingVerifiable.length,
            systemsInPlace: existingSystemsInPlace.length,
            summary: existingSummary.length,
          },
        });
        
        // RECOVERY: Pull server data into local cache and re-align timestamps
        if (training.synced_at) {
          console.log('[SAFETY] Recovering training: pulling server child data into local cache');
          try {
            await Promise.all([
              existingApproaches.length > 0 ? saveTrainingDataOffline('delivery_approaches', trainingId, existingApproaches) : Promise.resolve(),
              existingSystems.length > 0 ? saveTrainingDataOffline('operating_systems', trainingId, existingSystems) : Promise.resolve(),
              existingAttention.length > 0 ? saveTrainingDataOffline('immediate_attention', trainingId, existingAttention) : Promise.resolve(),
              existingVerifiable.length > 0 ? saveTrainingDataOffline('verifiable_items', trainingId, existingVerifiable) : Promise.resolve(),
              existingSystemsInPlace.length > 0 ? saveTrainingDataOffline('systems_in_place', trainingId, existingSystemsInPlace) : Promise.resolve(),
              existingSummary.length > 0 ? saveTrainingDataOffline('summary', trainingId, existingSummary) : Promise.resolve(),
            ]);
            const alignedTimestamp = recordStatus.updated_at || new Date().toISOString();
            await saveTrainingOffline({ ...training, synced_at: alignedTimestamp, updated_at: alignedTimestamp });
            console.log('[SAFETY] Training recovery complete');
          } catch (recoveryError) {
            console.error('[SAFETY] Training recovery failed:', recoveryError);
          }
        }
        
        return { success: false, skipped: true, reason: 'empty_local_guard' };
      }
    }
    
    // SUSPICIOUS EMPTY GUARD: If record has been edited but ALL child data is empty,
    // this likely means IndexedDB reads failed silently. Skip sync to prevent marking as complete.
    {
      const localIsCompletelyEmpty = delivery_approaches.length === 0 && operating_systems.length === 0 && 
        immediate_attention.length === 0 && verifiable_items.length === 0 && 
        systems_in_place.length === 0 && !summary;
      const createdAt = new Date(training.created_at || training.updated_at).getTime();
      const updatedAt = new Date(training.updated_at).getTime();
      const ageMinutes = (Date.now() - createdAt) / 60000;
      const wasEdited = (updatedAt - createdAt) > 60000;

      if (localIsCompletelyEmpty && wasEdited && ageMinutes > 5) {
        if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
          // Guard 1 already ran and didn't block — server is also empty. Allow sync.
          console.log('[SYNC] suspicious_empty_guard: both local and server are empty, allowing sync for genuinely blank training', {
            trainingId: trainingId.substring(0, 8),
          });
        } else {
          // Record doesn't exist on server yet — new blank form, allow sync
          console.log('[SYNC] suspicious_empty_guard: new training with no server data, allowing sync', {
            trainingId: trainingId.substring(0, 8),
          });
        }
      }
    }

    // Step 2: RECONCILE then UPSERT child data
    // Delete server rows that were removed locally, then upsert current local data
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      const reconcileResult = await reconcileAllChildTables(
        [
          { childTable: 'training_delivery_approaches', parentIdColumn: 'training_id', localItems: delivery_approaches, prefetchedServerRows: existingApproaches, expectedNonEmpty: trainingIdbReadFlags.delivery_approaches },
          { childTable: 'training_operating_systems', parentIdColumn: 'training_id', localItems: operating_systems, prefetchedServerRows: existingSystems, expectedNonEmpty: trainingIdbReadFlags.operating_systems },
          { childTable: 'training_immediate_attention', parentIdColumn: 'training_id', localItems: immediate_attention, prefetchedServerRows: existingAttention, expectedNonEmpty: trainingIdbReadFlags.immediate_attention },
          { childTable: 'training_verifiable_items', parentIdColumn: 'training_id', localItems: verifiable_items, prefetchedServerRows: existingVerifiable, expectedNonEmpty: trainingIdbReadFlags.verifiable_items },
          { childTable: 'training_systems_in_place', parentIdColumn: 'training_id', localItems: systems_in_place, prefetchedServerRows: existingSystemsInPlace, expectedNonEmpty: trainingIdbReadFlags.systems_in_place },
          { childTable: 'training_summary', parentIdColumn: 'training_id', localItems: summary ? [summary] : [], prefetchedServerRows: existingSummary, expectedNonEmpty: trainingIdbReadFlags.summary },
        ],
        trainingId,
        'training',
        user.id,
      );
      if (reconcileResult.blocked) {
        console.warn('[Atomic Sync] Training reconcile blocked — marking sync as failed so user can retry', {
          trainingId: trainingId.substring(0, 8),
          blockedTables: reconcileResult.blockedTables,
        });
        return {
          success: false,
          skipped: true,
          reason: 'reconcile_blocked',
          message: 'Some local deletions could not be confirmed against the server. Will retry on next sync.',
        };
      }
    }

    if (delivery_approaches.length > 0) {
      steps.push({
        table: 'training_delivery_approaches',
        operation: 'upsert',
        data: delivery_approaches,
      });
    }
    
    if (operating_systems.length > 0) {
      steps.push({
        table: 'training_operating_systems',
        operation: 'upsert',
        data: operating_systems,
      });
    }
    
    if (immediate_attention.length > 0) {
      steps.push({
        table: 'training_immediate_attention',
        operation: 'upsert',
        data: immediate_attention,
      });
    }
    
    if (verifiable_items.length > 0) {
      steps.push({
        table: 'training_verifiable_items',
        operation: 'upsert',
        data: verifiable_items,
      });
    }
    
    if (systems_in_place.length > 0) {
      steps.push({
        table: 'training_systems_in_place',
        operation: 'upsert',
        data: systems_in_place,
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
        operation: 'upsert',
        data: [sanitizedSummary],
      });
    }
    
    // FINAL STEP: Set synced_at ONLY after all related data is successfully inserted
    // This is the atomic guarantee - synced_at only updates when everything commits
    steps.push({
      table: 'trainings',
      operation: 'update',
      data: { synced_at: new Date().toISOString(), last_sync_source: 'main_thread' },
      filter: { id: trainingId },
    });
    
    // 5. Execute transaction
    const result = await executeTransaction(steps);
    
    if (!result.success) {
      throw new Error(`Transaction failed after ${result.completedSteps}/${result.totalSteps} steps. Rollback: ${result.rollbackSuccess ? 'successful' : 'failed'}`);
    }
    
    // S4: Skip post-transaction verify SELECT — `executeTransaction` row-count guard +
    // `align_synced_at` failure-on-missing-row already provide the same guarantee.
    
    // 6. Get cached inspector profile to attach to offline data
    const inspectorProfile = await getCachedProfile(user.id);
    
    // POST-SYNC ALIGNMENT: Call align_synced_at RPC to set synced_at = updated_at on server
    const { data: aligned, error: alignError } = await supabase.rpc('align_synced_at', {
      p_table_name: 'trainings',
      p_record_id: trainingId,
    });

    // S3: align_synced_at is ADVISORY. Transaction final step already wrote synced_at.
    let serverTimestamp: string;
    const alignedData = aligned as any;
    if (alignError || !alignedData || alignedData.error) {
      console.warn(
        '[Atomic Sync] align_synced_at non-fatal failure — using transaction timestamp',
        { table: 'trainings', id: trainingId, alignError: alignError?.message, aligned }
      );
      serverTimestamp = (steps[steps.length - 1].data as any).synced_at;
    } else {
      serverTimestamp = alignedData.updated_at;
      console.log(
        '%c[SYNC_TERMINAL] align_synced_at CONFIRMED %c%s',
        'color: #4ade80; font-family: monospace; font-weight: bold',
        'color: #86efac; font-family: monospace',
        `| table=trainings | id=${trainingId.substring(0,8)}... | ts=${serverTimestamp}`
      );
    }
    
    await saveTrainingOffline({
      ...training,
      synced_at: serverTimestamp,
      updated_at: serverTimestamp,
      inspector: inspectorProfile || { first_name: null, last_name: null, avatar_url: null },
    });
    
    // 7. If we swapped a temp ID, clean up old IndexedDB entries
    if (trainingIdMapping) {
      console.log('[Atomic Sync] Cleaning up old temp-ID entries from IndexedDB:', trainingIdMapping.oldId);
      
      // Delete old training entry keyed by temp ID
      await deleteOfflineTraining(trainingIdMapping.oldId);
      
      // Clean up child record stores that were keyed under the old temp training_id
      const childStores = ['delivery_approaches', 'operating_systems', 'immediate_attention', 'verifiable_items', 'systems_in_place', 'summary'] as const;
      for (const store of childStores) {
        await clearTrainingDataOffline(store, trainingIdMapping.oldId);
      }
      
      // Save child records under the new UUID
      await Promise.all([
        delivery_approaches.length > 0 ? saveTrainingDataOffline('delivery_approaches', trainingIdMapping.newId, delivery_approaches) : Promise.resolve(),
        operating_systems.length > 0 ? saveTrainingDataOffline('operating_systems', trainingIdMapping.newId, operating_systems) : Promise.resolve(),
        immediate_attention.length > 0 ? saveTrainingDataOffline('immediate_attention', trainingIdMapping.newId, immediate_attention) : Promise.resolve(),
        verifiable_items.length > 0 ? saveTrainingDataOffline('verifiable_items', trainingIdMapping.newId, verifiable_items) : Promise.resolve(),
        systems_in_place.length > 0 ? saveTrainingDataOffline('systems_in_place', trainingIdMapping.newId, systems_in_place) : Promise.resolve(),
        summary ? saveTrainingDataOffline('summary', trainingIdMapping.newId, [summary]) : Promise.resolve(),
      ]);
      
      // Relink photos from temp ID to new UUID so syncPhotos() can upload them
      await relinkPhotosToNewInspectionId(trainingIdMapping.oldId, trainingIdMapping.newId);
    }
    
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Successfully synced training with related data:', {
        trainingId,
        stepsCompleted: result.completedSteps,
        totalSteps: result.totalSteps,
      });
    }
    
    // Clean up any queued training_operations entries for this training
    // These are redundant now that the atomic sync has handled the data
    try {
      const queuedOps = await getQueuedTrainingOperations();
      const matchingOps = queuedOps.filter(op => {
        const opTrainingId = (op as any).trainingId || op.data?.id;
        return opTrainingId === trainingId || (trainingIdMapping && opTrainingId === trainingIdMapping.oldId);
      });
      for (const op of matchingOps) {
        await removeQueuedTrainingOperation(op.id!);
      }
      if (matchingOps.length > 0 && import.meta.env.DEV) {
        console.log(`[Atomic Sync] Cleaned up ${matchingOps.length} orphaned training_operations entries for ${trainingId}`);
      }
    } catch (cleanupErr) {
      console.warn('[Atomic Sync] Non-blocking: failed to clean training_operations queue:', cleanupErr);
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
export async function syncAllTrainingsAtomic(preValidatedUser?: CachedUser) {
  const capabilities = getMobileCapabilities();
  const ITEM_SYNC_TIMEOUT = 25000; // 25 seconds per item max (increased for mobile networks)
  
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Offline - skipping training sync');
    }
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  // Use pre-validated user if provided (avoids redundant LockManager calls)
  let user: CachedUser | null = preValidatedUser || null;
  if (!user) {
    // CRITICAL: Validate session before sync to ensure valid JWT for RLS
    try {
      user = await Promise.race([
        ensureValidSession(),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 8000))
      ]);
    } catch (e) {
      console.warn('[Atomic Sync] Session validation timed out for trainings, skipping');
      return { total: 0, success: 0, failed: 0, errors: [] };
    }
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
  
  // Batch limiting: only process MAX_BATCH_SIZE items per cycle
  const totalUnsynced = unsynced.length;
  const batch = unsynced.slice(0, MAX_BATCH_SIZE);
  const remaining = totalUnsynced - batch.length;
  
  if (import.meta.env.DEV) {
    console.log('[Atomic Sync] Starting sync for unsynced trainings', {
      total: totalUnsynced,
      batchSize: batch.length,
      remaining,
      platform: capabilities.isIOS ? 'iOS' : capabilities.isAndroid ? 'Android' : 'Desktop',
    });
  }
  
  // Emit initial progress
  syncProgressEmitter.emit({
    total: batch.length,
    current: 0,
    currentItem: `Starting training sync... (${totalUnsynced} total pending)`,
    phase: 'trainings',
    errors: [],
  });
  
  let successCount = 0;
  let failCount = 0;
  const errors: Array<{ id: string; error: string }> = [];
  
  // Reduced retries for faster recovery
  const maxRetries = capabilities.isMobile ? 2 : 1;
  // S2: Bounded concurrency — different trainingIds never share child rows.
  const itemConcurrency = capabilities.isMobile ? 3 : 5;
  let progressCounter = 0;

  await runWithConcurrency(batch, itemConcurrency, async (training, i) => {
    let retryCount = 0;
    let synced = false;

    while (retryCount < maxRetries && !synced) {
      // Emit progress for current item
      progressCounter++;
      syncProgressEmitter.emit({
        total: batch.length,
        current: progressCounter,
        currentItem: `${training.organization}${retryCount > 0 ? ` (retry ${retryCount})` : ''}${remaining > 0 ? ` (${remaining} more queued)` : ''}`,
        phase: 'trainings',
        errors,
      });

      try {
        // Per-item timeout - pass pre-validated user to skip redundant session validation
        const itemResult = await Promise.race([
          syncTrainingAtomic(training.id, user as CachedUser),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Item sync timeout')), ITEM_SYNC_TIMEOUT))
        ]);
        if (itemResult && typeof itemResult === 'object' && (itemResult as any).skipped) {
          synced = true;
        } else {
          successCount++;
          synced = true;
        }

        if (import.meta.env.DEV) {
          console.log(`[Atomic Sync] Synced training ${i + 1}/${batch.length} (${remaining} remaining):`, training.id);
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
  });
  
  console.log('[Atomic Sync] Training sync results:', {
    batch: batch.length,
    totalPending: totalUnsynced,
    remaining,
    success: successCount,
    failed: failCount,
  });
  
  return {
    total: totalUnsynced,
    success: successCount,
    failed: failCount,
    remaining,
    errors,
  };
}

/**
 * Sync daily assessment with all related data atomically
 */
export async function syncDailyAssessmentAtomic(assessmentId: string, preValidatedUser?: CachedUser) {
  if (!navigator.onLine) {
    throw new Error("Cannot sync while offline");
  }
  
  // Track temp-to-UUID mapping for post-sync IndexedDB cleanup
  let assessmentIdMapping: { oldId: string; newId: string } | null = null;
  
  try {
    // 1. Gather all data for this assessment
    const assessment = await getOfflineDailyAssessment(assessmentId);
    if (!assessment) {
      throw new Error("Daily assessment not found in local storage");
    }
    
    // Detect and replace temp assessment IDs with real UUIDs before validation
    if (assessment.id.startsWith('temp-')) {
      // S5: DEDUP via stable client_idempotency_key (server-enforced via partial unique index).
      const idempKey = (assessment as any).client_idempotency_key
        ?? assessment.id.replace(/^temp-/, '');

      const { data: dupRows } = await supabase
        .from('daily_assessments')
        .select('id')
        .eq('inspector_id', assessment.inspector_id)
        .eq('client_idempotency_key', idempKey)
        .limit(2);

      if (dupRows && dupRows.length > 0) {
        if (dupRows.length > 1) {
          console.warn('[Atomic Sync] Multiple server rows share idempotency key — adopting first, manual cleanup needed', {
            idempKey, ids: dupRows.map(r => r.id),
          });
        }
        const serverId = dupRows[0].id;
        console.log('[Atomic Sync] Found existing server record for temp assessment - adopting ID:', {
          tempId: assessment.id,
          serverId,
        });
        assessmentIdMapping = { oldId: assessment.id, newId: serverId };
        assessment.id = serverId;
        assessmentId = serverId;
      } else {
        const newId = crypto.randomUUID();
        assessmentIdMapping = { oldId: assessment.id, newId };
        console.log('[Atomic Sync] Replacing temp assessment ID with real UUID:', {
          oldId: assessment.id,
          newId,
        });
        assessment.id = newId;
        assessmentId = newId;
      }

      (assessment as any).client_idempotency_key = idempKey;
    }
    
    // Use pre-validated user from batch caller, or validate session if called individually
    const user = preValidatedUser || await ensureValidSession();
    if (!user) {
      console.error('[Atomic Sync] No valid session - sync aborted for assessment:', assessmentId);
      throw new Error('No valid session for sync');
    }
    
    // Auto-fix ownership for locally-created records, skip only for server-origin records
    if (assessment.inspector_id !== user.id) {
      if (!assessment.synced_at) {
        console.log('[Atomic Sync] Auto-fixing inspector_id for local assessment:', {
          assessmentId,
          oldInspectorId: assessment.inspector_id?.substring(0, 8),
          newInspectorId: user.id.substring(0, 8),
        });
        assessment.inspector_id = user.id;
        await saveDailyAssessmentOffline(assessment);
      } else {
        console.warn('[Atomic Sync] Skipping assessment - belongs to different user', {
          assessment_id: assessmentId,
        });
        return { success: false, skipped: true, reason: 'ownership_mismatch' };
      }
    }
    
    // Fetch child records using the ORIGINAL ID (before temp-to-UUID swap)
    // because they are stored in IndexedDB under the original assessment_id
    const fetchId = assessmentIdMapping ? assessmentIdMapping.oldId : assessmentId;
    
    const [bodRead, eodRead, opSysRead, eqRead, stRead, envRead] = await Promise.all([
      getAssessmentDataOfflineWithStatus('beginning_of_day', fetchId),
      getAssessmentDataOfflineWithStatus('end_of_day', fetchId),
      getAssessmentDataOfflineWithStatus('operating_systems', fetchId),
      getAssessmentDataOfflineWithStatus('equipment_checks', fetchId),
      getAssessmentDataOfflineWithStatus('structure_checks', fetchId),
      getAssessmentDataOfflineWithStatus('environment_checks', fetchId),
    ]);
    const rawBeginningOfDay = bodRead.items;
    const rawEndOfDay = eodRead.items;
    const rawOperatingSystems = opSysRead.items;
    const rawEquipmentChecks = eqRead.items;
    const rawStructureChecks = stRead.items;
    const rawEnvironmentChecks = envRead.items;
    const assessmentIdbReadFlags = {
      beginning_of_day: bodRead.readSucceeded,
      end_of_day: eodRead.readSucceeded,
      operating_systems: opSysRead.readSucceeded,
      equipment_checks: eqRead.readSucceeded,
      structure_checks: stRead.readSucceeded,
      environment_checks: envRead.readSucceeded,
    };
    
    // If we swapped the assessment ID, propagate new ID to all child records
    if (assessmentIdMapping) {
      rawBeginningOfDay.forEach(item => item.assessment_id = assessmentIdMapping!.newId);
      rawEndOfDay.forEach(item => item.assessment_id = assessmentIdMapping!.newId);
      rawOperatingSystems.forEach(item => item.assessment_id = assessmentIdMapping!.newId);
      rawEquipmentChecks.forEach(item => item.assessment_id = assessmentIdMapping!.newId);
      rawStructureChecks.forEach(item => item.assessment_id = assessmentIdMapping!.newId);
      rawEnvironmentChecks.forEach(item => item.assessment_id = assessmentIdMapping!.newId);
    }
    
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
    
    // RC-5: Skip remote status check for new records (never synced = never on server)
    const isNewAssessment = !assessment.synced_at;
    const recordStatus = isNewAssessment ? null : await checkRemoteRecordStatus('daily_assessments', assessmentId);
    
    // SAFEGUARD: Check if remote record was soft-deleted by someone else
    // This works for ALL users (regular and super admin) by bypassing RLS
    if (recordStatus?.record_exists && recordStatus?.is_deleted) {
      console.warn('[Atomic Sync] Remote assessment was soft-deleted - cleaning up local copy:', assessmentId);
      
      // PRE-DELETE BACKUP: Snapshot before destroying local data
      try {
        const localData = await getOfflineDailyAssessment(assessmentId);
        if (localData) {
          const [bod, eod, os, eq, st, env] = await Promise.all([
            getAssessmentDataOffline('beginning_of_day', assessmentId),
            getAssessmentDataOffline('end_of_day', assessmentId),
            getAssessmentDataOffline('operating_systems', assessmentId),
            getAssessmentDataOffline('equipment_checks', assessmentId),
            getAssessmentDataOffline('structure_checks', assessmentId),
            getAssessmentDataOffline('environment_checks', assessmentId),
          ]);
          appendVersion('daily_assessment', assessmentId, localData, {
            beginning_of_day: bod, end_of_day: eod, operating_systems: os,
            equipment_checks: eq, structure_checks: st, environment_checks: env,
          }, 'pre_delete').catch(() => {});
        }
      } catch (backupErr) {
        console.warn('[Atomic Sync] Pre-delete assessment backup failed:', backupErr);
      }
      
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
    
    // PRE-SYNC VERSION SNAPSHOT — capture immutable state before sync
    appendVersion('daily_assessment', assessmentId, assessment, {
      beginning_of_day, end_of_day, operating_systems,
      equipment_checks, structure_checks, environment_checks,
    }, 'pre_sync').catch(() => {});

    // FIELD-COUNT REGRESSION GUARD — block sync if local data regressed significantly
    const currentFieldCount = calculateFieldCount(assessment, {
      beginning_of_day, end_of_day, operating_systems,
      equipment_checks, structure_checks, environment_checks,
    });
    const previousFieldCount = await getLatestFieldCount(assessmentId);
    if (previousFieldCount !== null && previousFieldCount > 0) {
      const dropPercent = ((previousFieldCount - currentFieldCount) / previousFieldCount) * 100;
      if (dropPercent > 50) {
        const skipCount = (regressionSkipCounter.get(assessmentId) || 0) + 1;
        regressionSkipCounter.set(assessmentId, skipCount);
        if (skipCount <= MAX_REGRESSION_SKIPS) {
          console.error('[SAFETY] Blocked assessment sync: field count regression >50%', {
            assessmentId: assessmentId.substring(0, 8),
            previousFieldCount,
            currentFieldCount,
            dropPercent: dropPercent.toFixed(1),
            skipCount,
            maxSkips: MAX_REGRESSION_SKIPS,
          });
          return { success: false, skipped: true, reason: 'field_count_regression' };
        }
        console.warn('[SAFETY] Allowing assessment sync after max regression skips reached', {
          assessmentId: assessmentId.substring(0, 8),
          skipCount,
        });
        regressionSkipCounter.delete(assessmentId);
      } else {
        regressionSkipCounter.delete(assessmentId);
      }
    }

    // M15: Hard guard — fail loud if any temp- ID slipped past the transforms above.
    assertNoTempIds(assessment, 'daily_assessments.upsert');
    assertNoTempIdsInArray(beginning_of_day, 'daily_assessment_beginning_of_day.upsert');
    assertNoTempIdsInArray(end_of_day, 'daily_assessment_end_of_day.upsert');
    assertNoTempIdsInArray(operating_systems, 'daily_assessment_operating_systems.upsert');
    assertNoTempIdsInArray(equipment_checks, 'daily_assessment_equipment_checks.upsert');
    assertNoTempIdsInArray(structure_checks, 'daily_assessment_structure_checks.upsert');
    assertNoTempIdsInArray(environment_checks, 'daily_assessment_environment_checks.upsert');

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
    
    let existingBeginning: any[] = [];
    let existingEnd: any[] = [];
    let existingSystems: any[] = [];
    let existingEquipment: any[] = [];
    let existingStructure: any[] = [];
    let existingEnvironment: any[] = [];
    
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      [
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
      
      const serverHasChildData = existingBeginning.length > 0 || existingEnd.length > 0 || 
        existingSystems.length > 0 || existingEquipment.length > 0 || 
        existingStructure.length > 0 || existingEnvironment.length > 0;
      const localIsCompletelyEmpty = beginning_of_day.length === 0 && end_of_day.length === 0 && 
        operating_systems.length === 0 && equipment_checks.length === 0 && 
        structure_checks.length === 0 && environment_checks.length === 0;
      
      if (serverHasChildData && localIsCompletelyEmpty) {
        console.warn('[SAFETY] empty_local_guard: assessment server has child data but local is empty', {
          assessmentId,
          serverCounts: {
            beginning: existingBeginning.length,
            end: existingEnd.length,
            systems: existingSystems.length,
            equipment: existingEquipment.length,
            structure: existingStructure.length,
            environment: existingEnvironment.length,
          },
        });
        
        // RECOVERY: Pull server data into local cache and re-align timestamps
        if (assessment.synced_at) {
          console.log('[SAFETY] Recovering assessment: pulling server child data into local cache');
          try {
            await Promise.all([
              existingBeginning.length > 0 ? saveAssessmentDataOffline('beginning_of_day', assessmentId, existingBeginning) : Promise.resolve(),
              existingEnd.length > 0 ? saveAssessmentDataOffline('end_of_day', assessmentId, existingEnd) : Promise.resolve(),
              existingSystems.length > 0 ? saveAssessmentDataOffline('operating_systems', assessmentId, existingSystems) : Promise.resolve(),
              existingEquipment.length > 0 ? saveAssessmentDataOffline('equipment_checks', assessmentId, existingEquipment) : Promise.resolve(),
              existingStructure.length > 0 ? saveAssessmentDataOffline('structure_checks', assessmentId, existingStructure) : Promise.resolve(),
              existingEnvironment.length > 0 ? saveAssessmentDataOffline('environment_checks', assessmentId, existingEnvironment) : Promise.resolve(),
            ]);
            const alignedTimestamp = recordStatus.updated_at || new Date().toISOString();
            await saveDailyAssessmentOffline({ ...assessment, synced_at: alignedTimestamp, updated_at: alignedTimestamp });
            console.log('[SAFETY] Assessment recovery complete');
          } catch (recoveryError) {
            console.error('[SAFETY] Assessment recovery failed:', recoveryError);
          }
        }
        
        return { success: false, skipped: true, reason: 'empty_local_guard' };
      }
    }
    
    // SUSPICIOUS EMPTY GUARD: If record has been edited but ALL child data is empty,
    // this likely means IndexedDB reads failed silently. However, if we reach here,
    // the empty_local_guard above already verified the server ALSO has no child data
    // (or the record doesn't exist on server). So this is a legitimately blank form — allow sync.
    // Only block if the record wasn't checked by Guard 1 (i.e., doesn't exist on server).
    {
      const localIsCompletelyEmpty = beginning_of_day.length === 0 && end_of_day.length === 0 && 
        operating_systems.length === 0 && equipment_checks.length === 0 && 
        structure_checks.length === 0 && environment_checks.length === 0;
      const createdAt = new Date(assessment.created_at || assessment.updated_at).getTime();
      const updatedAt = new Date(assessment.updated_at).getTime();
      const ageMinutes = (Date.now() - createdAt) / 60000;
      const wasEdited = (updatedAt - createdAt) > 60000;

      if (localIsCompletelyEmpty && wasEdited && ageMinutes > 5) {
        if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
          // Guard 1 already ran and didn't block — server is also empty. Allow sync.
          console.log('[SYNC] suspicious_empty_guard: both local and server are empty, allowing sync for genuinely blank form', {
            assessmentId: assessmentId.substring(0, 8),
          });
        } else {
          // Record doesn't exist on server yet — new blank form, allow sync
          console.log('[SYNC] suspicious_empty_guard: new record with no server data, allowing sync', {
            assessmentId: assessmentId.substring(0, 8),
          });
        }
      }
    }

    // Step 2: RECONCILE then UPSERT child data
    // Delete server rows that were removed locally, then upsert current local data
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      const reconcileResult = await reconcileAllChildTables(
        [
          { childTable: 'daily_assessment_beginning_of_day', parentIdColumn: 'assessment_id', localItems: beginning_of_day, prefetchedServerRows: existingBeginning, expectedNonEmpty: assessmentIdbReadFlags.beginning_of_day },
          { childTable: 'daily_assessment_end_of_day', parentIdColumn: 'assessment_id', localItems: end_of_day, prefetchedServerRows: existingEnd, expectedNonEmpty: assessmentIdbReadFlags.end_of_day },
          { childTable: 'daily_assessment_operating_systems', parentIdColumn: 'assessment_id', localItems: operating_systems, prefetchedServerRows: existingSystems, expectedNonEmpty: assessmentIdbReadFlags.operating_systems },
          { childTable: 'daily_assessment_equipment_checks', parentIdColumn: 'assessment_id', localItems: equipment_checks, prefetchedServerRows: existingEquipment, expectedNonEmpty: assessmentIdbReadFlags.equipment_checks },
          { childTable: 'daily_assessment_structure_checks', parentIdColumn: 'assessment_id', localItems: structure_checks, prefetchedServerRows: existingStructure, expectedNonEmpty: assessmentIdbReadFlags.structure_checks },
          { childTable: 'daily_assessment_environment_checks', parentIdColumn: 'assessment_id', localItems: environment_checks, prefetchedServerRows: existingEnvironment, expectedNonEmpty: assessmentIdbReadFlags.environment_checks },
        ],
        assessmentId,
        'daily_assessment',
        user.id,
      );
      if (reconcileResult.blocked) {
        console.warn('[Atomic Sync] Daily assessment reconcile blocked — marking sync as failed so user can retry', {
          assessmentId: assessmentId.substring(0, 8),
          blockedTables: reconcileResult.blockedTables,
        });
        return {
          success: false,
          skipped: true,
          reason: 'reconcile_blocked',
          message: 'Some local deletions could not be confirmed against the server. Will retry on next sync.',
        };
      }
    }

    if (beginning_of_day.length > 0) {
      steps.push({
        table: 'daily_assessment_beginning_of_day',
        operation: 'upsert',
        data: beginning_of_day,
      });
    }
    
    if (end_of_day.length > 0) {
      steps.push({
        table: 'daily_assessment_end_of_day',
        operation: 'upsert',
        data: end_of_day,
      });
    }
    
    if (operating_systems.length > 0) {
      steps.push({
        table: 'daily_assessment_operating_systems',
        operation: 'upsert',
        data: operating_systems,
      });
    }
    
    if (equipment_checks.length > 0) {
      steps.push({
        table: 'daily_assessment_equipment_checks',
        operation: 'upsert',
        data: equipment_checks,
      });
    }
    
    if (structure_checks.length > 0) {
      steps.push({
        table: 'daily_assessment_structure_checks',
        operation: 'upsert',
        data: structure_checks,
      });
    }
    
    if (environment_checks.length > 0) {
      steps.push({
        table: 'daily_assessment_environment_checks',
        operation: 'upsert',
        data: environment_checks,
      });
    }
    
    // FINAL STEP: Set synced_at ONLY after all related data is successfully inserted
    // This is the atomic guarantee - synced_at only updates when everything commits
    steps.push({
      table: 'daily_assessments',
      operation: 'update',
      data: { synced_at: new Date().toISOString(), last_sync_source: 'main_thread' },
      filter: { id: assessmentId },
    });
    
    // 5. Execute transaction
    const result = await executeTransaction(steps);
    
    if (!result.success) {
      throw new Error(`Transaction failed after ${result.completedSteps}/${result.totalSteps} steps. Rollback: ${result.rollbackSuccess ? 'successful' : 'failed'}`);
    }
    
    // S4: Skip post-transaction verify SELECT — `executeTransaction` row-count guard +
    // `align_synced_at` failure-on-missing-row already provide the same guarantee.
    
    // 6. Get cached inspector profile to attach to offline data
    const inspectorProfile = await getCachedProfile(user.id);
    
    // POST-SYNC ALIGNMENT: Call align_synced_at RPC to set synced_at = updated_at on server
    const { data: aligned, error: alignError } = await supabase.rpc('align_synced_at', {
      p_table_name: 'daily_assessments',
      p_record_id: assessmentId,
    });

    // S3: align_synced_at is ADVISORY. Transaction final step already wrote synced_at.
    let serverTimestamp: string;
    const alignedData = aligned as any;
    if (alignError || !alignedData || alignedData.error) {
      console.warn(
        '[Atomic Sync] align_synced_at non-fatal failure — using transaction timestamp',
        { table: 'daily_assessments', id: assessmentId, alignError: alignError?.message, aligned }
      );
      serverTimestamp = (steps[steps.length - 1].data as any).synced_at;
    } else {
      serverTimestamp = alignedData.updated_at;
      console.log(
        '%c[SYNC_TERMINAL] align_synced_at CONFIRMED %c%s',
        'color: #4ade80; font-family: monospace; font-weight: bold',
        'color: #86efac; font-family: monospace',
        `| table=daily_assessments | id=${assessmentId.substring(0,8)}... | ts=${serverTimestamp}`
      );
    }
    
    await saveDailyAssessmentOffline({
      ...assessment,
      synced_at: serverTimestamp,
      updated_at: serverTimestamp,
      inspector: inspectorProfile || { first_name: null, last_name: null, avatar_url: null },
    });
    
    // 7. If we swapped a temp ID, clean up old IndexedDB entries
    if (assessmentIdMapping) {
      console.log('[Atomic Sync] Cleaning up old temp-ID entries from IndexedDB:', assessmentIdMapping.oldId);
      
      // Delete old assessment entry keyed by temp ID
      await deleteOfflineDailyAssessment(assessmentIdMapping.oldId);
      
      // Clean up child record stores that were keyed under the old temp assessment_id
      const childStores = ['beginning_of_day', 'end_of_day', 'operating_systems', 'equipment_checks', 'structure_checks', 'environment_checks'] as const;
      for (const store of childStores) {
        await clearAssessmentDataOffline(store, assessmentIdMapping.oldId);
      }
      
      // Save child records under the new UUID
      await Promise.all([
        beginning_of_day.length > 0 ? saveAssessmentDataOffline('beginning_of_day', assessmentIdMapping.newId, beginning_of_day) : Promise.resolve(),
        end_of_day.length > 0 ? saveAssessmentDataOffline('end_of_day', assessmentIdMapping.newId, end_of_day) : Promise.resolve(),
        operating_systems.length > 0 ? saveAssessmentDataOffline('operating_systems', assessmentIdMapping.newId, operating_systems) : Promise.resolve(),
        equipment_checks.length > 0 ? saveAssessmentDataOffline('equipment_checks', assessmentIdMapping.newId, equipment_checks) : Promise.resolve(),
        structure_checks.length > 0 ? saveAssessmentDataOffline('structure_checks', assessmentIdMapping.newId, structure_checks) : Promise.resolve(),
        environment_checks.length > 0 ? saveAssessmentDataOffline('environment_checks', assessmentIdMapping.newId, environment_checks) : Promise.resolve(),
      ]);
      
      // Relink photos from temp ID to new UUID so syncPhotos() can upload them
      await relinkPhotosToNewInspectionId(assessmentIdMapping.oldId, assessmentIdMapping.newId);
    }
    
    // Clean up any queued assessment_operations entries for this assessment
    try {
      const queuedOps = await getQueuedAssessmentOperations();
      const matchingOps = queuedOps.filter(op => {
        const opAssessmentId = (op as any).assessmentId || op.data?.id;
        return opAssessmentId === assessmentId || (assessmentIdMapping && opAssessmentId === assessmentIdMapping.oldId);
      });
      for (const op of matchingOps) {
        await removeQueuedAssessmentOperation(op.id!);
      }
      if (matchingOps.length > 0 && import.meta.env.DEV) {
        console.log(`[Atomic Sync] Cleaned up ${matchingOps.length} orphaned assessment_operations entries for ${assessmentId}`);
      }
    } catch (cleanupErr) {
      console.warn('[Atomic Sync] Non-blocking: failed to clean assessment_operations queue:', cleanupErr);
    }
    
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
export async function syncAllDailyAssessmentsAtomic(preValidatedUser?: CachedUser) {
  const capabilities = getMobileCapabilities();
  const ITEM_SYNC_TIMEOUT = 25000; // 25 seconds per item max (increased for mobile networks)
  
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Offline - skipping daily assessment sync');
    }
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  // Use pre-validated user if provided (avoids redundant LockManager calls)
  let user: CachedUser | null = preValidatedUser || null;
  if (!user) {
    // CRITICAL: Validate session before sync to ensure valid JWT for RLS
    try {
      user = await Promise.race([
        ensureValidSession(),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 8000))
      ]);
    } catch (e) {
      console.warn('[Atomic Sync] Session validation timed out for assessments, skipping');
      return { total: 0, success: 0, failed: 0, errors: [] };
    }
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
  
  // Batch limiting: only process MAX_BATCH_SIZE items per cycle
  const totalUnsynced = unsynced.length;
  const batch = unsynced.slice(0, MAX_BATCH_SIZE);
  const remaining = totalUnsynced - batch.length;
  
  if (import.meta.env.DEV) {
    console.log('[Atomic Sync] Starting sync for unsynced daily assessments', {
      total: totalUnsynced,
      batchSize: batch.length,
      remaining,
      platform: capabilities.isIOS ? 'iOS' : capabilities.isAndroid ? 'Android' : 'Desktop',
    });
  }
  
  // Emit initial progress
  syncProgressEmitter.emit({
    total: batch.length,
    current: 0,
    currentItem: `Starting daily assessment sync... (${totalUnsynced} total pending)`,
    phase: 'assessments',
    errors: [],
  });
  
  let successCount = 0;
  let failCount = 0;
  const errors: Array<{ id: string; error: string }> = [];
  
  // Reduced retries for faster recovery
  const maxRetries = capabilities.isMobile ? 2 : 1;
  // S2: Bounded concurrency — different assessmentIds never share child rows.
  const itemConcurrency = capabilities.isMobile ? 3 : 5;
  let progressCounter = 0;

  await runWithConcurrency(batch, itemConcurrency, async (assessment, i) => {
    let retryCount = 0;
    let synced = false;

    while (retryCount < maxRetries && !synced) {
      // Emit progress for current item
      progressCounter++;
      syncProgressEmitter.emit({
        total: batch.length,
        current: progressCounter,
        currentItem: `${assessment.organization} - ${assessment.site}${retryCount > 0 ? ` (retry ${retryCount})` : ''}${remaining > 0 ? ` (${remaining} more queued)` : ''}`,
        phase: 'assessments',
        errors,
      });

      try {
        // Per-item timeout - pass pre-validated user to skip redundant session validation
        const itemResult = await Promise.race([
          syncDailyAssessmentAtomic(assessment.id, user as CachedUser),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Item sync timeout')), ITEM_SYNC_TIMEOUT))
        ]);
        if (itemResult && typeof itemResult === 'object' && (itemResult as any).skipped) {
          synced = true;
        } else {
          successCount++;
          synced = true;
        }

        if (import.meta.env.DEV) {
          console.log(`[Atomic Sync] Synced daily assessment ${i + 1}/${batch.length} (${remaining} remaining):`, assessment.id);
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
  });
  
  console.log('[Atomic Sync] Daily assessment sync results:', {
    batch: batch.length,
    totalPending: totalUnsynced,
    remaining,
    success: successCount,
    failed: failCount,
  });
  
  return {
    total: totalUnsynced,
    success: successCount,
    failed: failCount,
    remaining,
    errors,
  };
}
