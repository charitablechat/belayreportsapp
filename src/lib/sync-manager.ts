import { supabase } from "@/integrations/supabase/client";
import { getUserWithCache } from "@/lib/cached-auth";
import { 
  getUnsyncedInspections, 
  saveInspectionOffline, 
  getQueuedOperations, 
  removeQueuedOperation,
  incrementOperationRetry,
  getUnuploadedPhotos,
  markPhotoAsUploaded,
  deleteOfflinePhoto,
  getUnsyncedDailyAssessments,
  saveDailyAssessmentOffline,
  getQueuedAssessmentOperations,
  removeQueuedAssessmentOperation,
  incrementAssessmentOperationRetry
} from "./offline-storage";
import { getCachedProfile } from "./profile-cache";

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // Start with 1 second

/**
 * @deprecated Use syncAllInspectionsAtomic from atomic-sync-manager.ts instead
 * This function does not handle soft-deleted records correctly for regular users
 * due to RLS policies blocking SELECT on deleted records.
 */
export async function syncInspections() {
  console.warn('[Sync Manager] DEPRECATED: syncInspections() does not handle soft-deleted records correctly. Use syncAllInspectionsAtomic() instead.');
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Offline - skipping sync');
    }
    return;
  }

  if (import.meta.env.DEV) {
    console.log('[Sync Manager] Starting sync...');
  }

  try {
    // 1. Process queued operations first
    const queuedOps = await getQueuedOperations();
    
    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Processing queued operations:', queuedOps.length);
    }

    for (const op of queuedOps) {
      try {
        if (op.retries >= MAX_RETRIES) {
          if (import.meta.env.DEV) {
            console.warn('[Sync Manager] Max retries reached for operation:', op);
          }
          continue;
        }

        // Ensure inspector_id matches current user
        const user = await getUserWithCache();
        if (!user) {
          console.error('[Sync Manager] User not authenticated, skipping operation');
          continue;
        }

        // Exclude joined 'inspector' object - only inspector_id column exists in DB
        const { inspector, ...dataWithoutInspector } = op.data as any;
        const dataToSync = {
          ...dataWithoutInspector,
          // Preserve original inspector_id, only set if not present
          inspector_id: dataWithoutInspector.inspector_id || user.id,
        };

        if (op.type === 'create' || op.type === 'update') {
          await supabase.from("inspections").upsert(dataToSync);
        } else if (op.type === 'delete') {
          await supabase.from("inspections").delete().eq('id', op.inspectionId);
        }

        await removeQueuedOperation(op.id);
        
        if (import.meta.env.DEV) {
          console.log('[Sync Manager] Processed operation:', op.type, op.inspectionId);
        }
      } catch (error) {
        console.error('[Sync Manager] Operation failed:', error);
        await incrementOperationRetry(op.id);
        
        // Exponential backoff
        await new Promise(resolve => 
          setTimeout(resolve, RETRY_DELAY * Math.pow(2, op.retries))
        );
      }
    }

    // 2. Sync unsynced inspections (filter by current user)
    const currentUser = await getUserWithCache();
    const unsynced = await getUnsyncedInspections(currentUser?.id);
    
    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Syncing unsynced inspections:', unsynced.length);
    }
    
    for (const inspection of unsynced) {
      try {
        // Ensure inspector_id matches current user
        const user = await getUserWithCache();
        if (!user) {
          console.error('[Sync Manager] User not authenticated, skipping sync');
          continue;
        }

        // Exclude joined 'inspector' object - only inspector_id column exists in DB
        const { inspector, ...inspectionWithoutJoin } = inspection as any;
        const inspectionToSync = {
          ...inspectionWithoutJoin,
          // Preserve original inspector_id
          inspector_id: inspectionWithoutJoin.inspector_id || user.id,
        };

        // Check if inspection exists in remote
        const { data: remoteData } = await supabase
          .from("inspections")
          .select("updated_at")
          .eq("id", inspection.id)
          .maybeSingle();

        // Conflict detection and logging
        if (remoteData) {
          const remoteUpdated = new Date(remoteData.updated_at).getTime();
          const localUpdated = new Date(inspection.updated_at).getTime();
          
          // If both versions were updated within a small time window (e.g., 5 seconds),
          // and local is not significantly newer, consider it a conflict
          const timeDiff = Math.abs(remoteUpdated - localUpdated);
          const isConflict = timeDiff > 5000 && remoteUpdated > localUpdated;
          
          if (isConflict) {
            // Check if an unresolved conflict already exists
            try {
              const { data: existingConflict } = await supabase
                .from('sync_conflicts')
                .select('id')
                .eq('inspection_id', inspection.id)
                .eq('resolved', false)
                .maybeSingle();
              
              if (!existingConflict) {
                // Validate organization_id before inserting
                const organizationId = inspection.organization_id;
                if (!organizationId) {
                  console.error('[Sync Manager] Cannot record conflict - missing organization_id:', inspection.id);
                  continue;
                }
                
                await supabase.from('sync_conflicts').insert({
                  inspection_id: inspection.id,
                  organization_id: organizationId,
                  local_updated_at: inspection.updated_at,
                  remote_updated_at: remoteData.updated_at,
                  resolved: false,
                });
                
                if (import.meta.env.DEV) {
                  console.log('[Sync Manager] Conflict detected and logged:', inspection.id);
                }
              } else if (import.meta.env.DEV) {
                console.log('[Sync Manager] Conflict already exists for:', inspection.id);
              }
              
              // Skip syncing this inspection - user needs to resolve conflict
              continue;
            } catch (conflictError) {
              console.error('[Sync Manager] Failed to check/log conflict:', conflictError);
              // Continue with sync even if conflict logging fails
            }
          }
          
          if (remoteUpdated > localUpdated && !isConflict) {
            if (import.meta.env.DEV) {
              console.log('[Sync Manager] Remote is newer, skipping:', inspection.id);
            }
            continue; // Remote is newer, skip local update
          }
        }

        // Sync to Supabase
        const { error } = await supabase
          .from("inspections")
          .upsert({
            ...inspectionToSync,
            synced_at: new Date().toISOString(),
          });

        if (error) throw error;

        // Get cached inspector profile to attach to offline data
        const inspectorProfile = await getCachedProfile(user.id);

        // Update local storage with sync timestamp, corrected inspector_id, and profile
        await saveInspectionOffline({
          ...inspectionToSync,
          synced_at: new Date().toISOString(),
          inspector: inspectorProfile || { first_name: null, last_name: null, avatar_url: null },
        });

        if (import.meta.env.DEV) {
          console.log('[Sync Manager] Synced inspection:', inspection.id);
        }
      } catch (error) {
        console.error('[Sync Manager] Failed to sync inspection:', inspection.id, error);
        // Continue with other inspections even if one fails
      }
    }

    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Sync completed successfully:', unsynced.length, 'inspections');
    }
  } catch (error) {
    console.error('[Sync Manager] Sync error:', error);
  }
}

// Photo sync manager
export async function syncPhotos() {
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Offline - skipping photo sync');
    }
    return;
  }

  if (import.meta.env.DEV) {
    console.log('[Sync Manager] Starting photo sync...');
  }

  try {
    const unuploadedPhotos = await getUnuploadedPhotos();
    
    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Uploading photos:', unuploadedPhotos.length);
    }

    let successCount = 0;

    for (const photo of unuploadedPhotos) {
      try {
        const user = await getUserWithCache();
        if (!user) throw new Error("Not authenticated");

        const fileExt = photo.fileName.split('.').pop();
        const fileName = `${user.id}/${photo.inspectionId}/${Date.now()}.${fileExt}`;
        
        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('inspection-photos')
          .upload(fileName, photo.blob);

        if (uploadError) throw uploadError;

        // Save to database with file path (signed URLs generated on read)
        const { error: dbError } = await supabase
          .from('inspection_photos')
          .insert({
            inspection_id: photo.inspectionId,
            photo_url: fileName,
            photo_section: photo.section,
          });

        if (dbError) throw dbError;

        // Mark as uploaded and remove blob from local storage
        await markPhotoAsUploaded(photo.id, fileName);
        successCount++;

        if (import.meta.env.DEV) {
          console.log('[Sync Manager] Uploaded photo:', photo.id);
        }
      } catch (error) {
        console.error('[Sync Manager] Failed to upload photo:', photo.id, error);
        // Continue with other photos even if one fails
      }
    }

    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Photo sync completed:', successCount, 'photos');
    }
  } catch (error) {
    console.error('[Sync Manager] Photo sync error:', error);
  }
}

// Daily Assessment sync
/**
 * @deprecated Use syncAllDailyAssessmentsAtomic from atomic-sync-manager.ts instead
 * This function does not handle soft-deleted records correctly for regular users.
 */
export async function syncDailyAssessments() {
  console.warn('[Sync Manager] DEPRECATED: syncDailyAssessments() does not handle soft-deleted records correctly. Use syncAllDailyAssessmentsAtomic() instead.');
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Daily Assessment Sync] Offline - skipping sync');
    }
    return;
  }

  if (import.meta.env.DEV) {
    console.log('[Daily Assessment Sync] Starting sync...');
  }

  try {
    // Track IDs synced from queue to prevent double processing
    const syncedFromQueue = new Set<string>();
    
    // Process queued operations first
    const queuedOps = await getQueuedAssessmentOperations();
    
    if (import.meta.env.DEV) {
      console.log('[Daily Assessment Sync] Processing queued operations:', queuedOps.length);
    }

    for (const op of queuedOps) {
      try {
        if (op.retries >= MAX_RETRIES) {
          if (import.meta.env.DEV) {
            console.warn('[Daily Assessment Sync] Max retries reached for operation:', op);
          }
          // Remove the operation if max retries reached
          if (op.id !== undefined && op.id !== null) {
            await removeQueuedAssessmentOperation(op.id);
          }
          continue;
        }

        const user = await getUserWithCache();
        if (!user) {
          console.error('[Daily Assessment Sync] User not authenticated, skipping operation');
          continue;
        }

        // Exclude joined 'inspector' object - only inspector_id column exists in DB
        const { inspector, ...dataWithoutInspector } = op.data as any;
        const dataToSync = {
          ...dataWithoutInspector,
          // Preserve original inspector_id
          inspector_id: dataWithoutInspector.inspector_id || user.id,
        };

        if (op.type === 'create' || op.type === 'update') {
          await supabase.from("daily_assessments").upsert(dataToSync);
          // Track successfully synced assessment ID
          syncedFromQueue.add(op.assessmentId);
        } else if (op.type === 'delete') {
          await supabase.from("daily_assessments").delete().eq('id', op.assessmentId);
        }

        // Only remove if ID is valid
        if (op.id !== undefined && op.id !== null) {
          await removeQueuedAssessmentOperation(op.id);
        }
        
        if (import.meta.env.DEV) {
          console.log('[Daily Assessment Sync] Processed operation:', op.type, op.assessmentId);
        }
      } catch (error) {
        console.error('[Daily Assessment Sync] Operation failed:', error);
        // Only increment retry if ID is valid
        if (op.id !== undefined && op.id !== null) {
          await incrementAssessmentOperationRetry(op.id);
        }
        
        await new Promise(resolve => 
          setTimeout(resolve, RETRY_DELAY * Math.pow(2, op.retries))
        );
      }
    }

    // Phase 2: Add user ID filter to prevent cross-user sync
    const syncUser = await getUserWithCache();
    const unsynced = await getUnsyncedDailyAssessments(syncUser?.id);
    
    if (import.meta.env.DEV) {
      console.log('[Daily Assessment Sync] Syncing unsynced assessments:', unsynced.length);
    }
    
    for (const assessment of unsynced) {
      try {
        // Phase 3: Skip if already synced from queue
        if (syncedFromQueue.has(assessment.id)) {
          if (import.meta.env.DEV) {
            console.log('[Daily Assessment Sync] Skipping - already synced from queue:', assessment.id);
          }
          // Update synced_at since it was successfully synced from queue
          assessment.synced_at = new Date().toISOString();
          await saveDailyAssessmentOffline(assessment);
          continue;
        }
        
        const user = await getUserWithCache();
        if (!user) {
          console.error('[Daily Assessment Sync] User not authenticated, skipping sync');
          continue;
        }

        // Exclude joined 'inspector' object - only inspector_id column exists in DB
        const { inspector, ...assessmentWithoutInspector } = assessment as any;
        const assessmentToSync = {
          ...assessmentWithoutInspector,
          // Preserve original inspector_id
          inspector_id: assessmentWithoutInspector.inspector_id || user.id,
        };

        const { error: upsertError } = await supabase
          .from("daily_assessments")
          .upsert(assessmentToSync);

        if (upsertError) throw upsertError;

        // Update synced_at timestamp
        assessment.synced_at = new Date().toISOString();
        await saveDailyAssessmentOffline(assessment);
        
        if (import.meta.env.DEV) {
          console.log('[Daily Assessment Sync] Synced assessment:', assessment.id);
        }
      } catch (error) {
        console.error('[Daily Assessment Sync] Failed to sync assessment:', error);
      }
    }

    if (import.meta.env.DEV) {
      console.log('[Daily Assessment Sync] Sync completed');
    }
  } catch (error) {
    console.error('[Daily Assessment Sync] Sync failed:', error);
    // Don't re-throw - background sync errors should not propagate to UI
  }
}

// Training sync
/**
 * @deprecated Use syncAllTrainingsAtomic from atomic-sync-manager.ts instead
 * This function does not handle soft-deleted records correctly for regular users.
 */
export async function syncTrainings() {
  console.warn('[Sync Manager] DEPRECATED: syncTrainings() does not handle soft-deleted records correctly. Use syncAllTrainingsAtomic() instead.');
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Training Sync] Offline - skipping sync');
    }
    return;
  }

  if (import.meta.env.DEV) {
    console.log('[Training Sync] Starting sync...');
  }

  try {
    const { getQueuedTrainingOperations, removeQueuedTrainingOperation, incrementTrainingOperationRetry, getUnsyncedTrainings, saveTrainingOffline } = await import('./offline-storage');
    
    const queuedOps = await getQueuedTrainingOperations();
    
    if (import.meta.env.DEV) {
      console.log('[Training Sync] Processing queued operations:', queuedOps.length);
    }

    for (const op of queuedOps) {
      try {
        if (op.retries >= MAX_RETRIES) {
          if (import.meta.env.DEV) {
            console.warn('[Training Sync] Max retries reached for operation:', op);
          }
          continue;
        }

        const user = await getUserWithCache();
        if (!user) {
          console.error('[Training Sync] User not authenticated, skipping operation');
          continue;
        }

        // Exclude any non-existent columns (e.g., 'trainer' which should be 'trainer_of_record')
        const { trainer, inspector, ...cleanData } = op.data as any;
        const dataToSync = {
          ...cleanData,
          // Preserve original inspector_id
          inspector_id: cleanData.inspector_id || user.id,
        };

        if (op.type === 'create' || op.type === 'update') {
          await supabase.from("trainings").upsert(dataToSync);
        } else if (op.type === 'delete') {
          await supabase.from("trainings").delete().eq('id', op.trainingId);
        }

        // Only remove if ID is valid
        if (op.id !== undefined && op.id !== null) {
          await removeQueuedTrainingOperation(op.id);
        }
        
        if (import.meta.env.DEV) {
          console.log('[Training Sync] Processed operation:', op.type, op.trainingId);
        }
      } catch (error) {
        console.error('[Training Sync] Operation failed:', error);
        // Only increment retry if ID is valid
        if (op.id !== undefined && op.id !== null) {
          await incrementTrainingOperationRetry(op.id);
        }
        
        await new Promise(resolve => 
          setTimeout(resolve, RETRY_DELAY * Math.pow(2, op.retries))
        );
      }
    }

    const unsynced = await getUnsyncedTrainings();
    
    if (import.meta.env.DEV) {
      console.log('[Training Sync] Syncing unsynced trainings:', unsynced.length);
    }
    
    for (const training of unsynced) {
      try {
        const user = await getUserWithCache();
        if (!user) {
          console.error('[Training Sync] User not authenticated, skipping sync');
          continue;
        }

        // Exclude any non-existent columns (e.g., 'trainer' which should be 'trainer_of_record')
        const { trainer, inspector, ...cleanTraining } = training as any;
        const trainingToSync = {
          ...cleanTraining,
          // Preserve original inspector_id
          inspector_id: cleanTraining.inspector_id || user.id,
        };

        const { error: upsertError } = await supabase
          .from("trainings")
          .upsert(trainingToSync);

        if (upsertError) throw upsertError;

        training.synced_at = new Date().toISOString();
        await saveTrainingOffline(training);
        
        if (import.meta.env.DEV) {
          console.log('[Training Sync] Synced training:', training.id);
        }
      } catch (error) {
        console.error('[Training Sync] Failed to sync training:', error);
      }
    }

    if (import.meta.env.DEV) {
      console.log('[Training Sync] Sync completed');
    }
  } catch (error) {
    console.error('[Training Sync] Sync failed:', error);
    // Don't re-throw - background sync errors should not propagate to UI
  }
}

// Auto-sync when coming online - use atomic sync for trainings and daily assessments
if (typeof window !== "undefined") {
  window.addEventListener("online", async () => {
    if (import.meta.env.DEV) {
      console.log('[Sync Manager] Network online, triggering sync...');
    }
    
    // Import atomic sync functions
    const { syncAllInspectionsAtomic, syncAllTrainingsAtomic, syncAllDailyAssessmentsAtomic } = await import('./atomic-sync-manager');
    
    setTimeout(async () => {
      try {
        // Use atomic sync for all data types
        await Promise.all([
          syncAllInspectionsAtomic(),
          syncAllTrainingsAtomic(),
          syncAllDailyAssessmentsAtomic(),
          syncPhotos()
        ]);
      } catch (error) {
        console.error('[Sync Manager] Auto-sync failed:', error);
      }
    }, 1000);
  });
}
