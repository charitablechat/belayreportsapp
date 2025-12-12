import { supabase } from "@/integrations/supabase/client";
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
  TransactionStep 
} from "./transaction-manager";
import { syncProgressEmitter } from "@/hooks/useSyncProgress";
import { getMobileCapabilities } from "./mobile-detection";
import { toast } from "sonner";
import { getCachedProfile } from "./profile-cache";

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
          
          // No existing conflict - record a new one
          const { error: conflictError } = await supabase.from('sync_conflicts').insert({
            inspection_id: inspectionId,
            organization_id: organizationId,
            local_updated_at: inspection.updated_at,
            remote_updated_at: remoteInspection.updated_at,
            resolved: false,
          });
          
          // Only show conflict toast if successfully recorded
          if (!conflictError) {
            toast.error("Sync Conflict Detected", {
              description: `Changes conflict for ${inspection.organization} - ${inspection.location}. Please resolve in settings.`,
              duration: 10000,
            });
          } else {
            console.error('[Atomic Sync] Failed to record conflict:', conflictError);
            toast.warning("Sync Issue Detected", {
              description: `There may be conflicting changes for ${inspection.organization}. Try syncing again.`,
              duration: 8000,
            });
          }
        } else {
          if (import.meta.env.DEV) {
            console.log('[Atomic Sync] Conflict already exists for inspection:', inspectionId);
          }
        }
        
        throw new Error("Sync conflict detected - user must resolve");
      }
    }
    
    // 4. Build transaction steps
    const steps: TransactionStep[] = [];
    
    // Exclude joined 'inspector' object - only inspector_id column exists in DB
    const { inspector, ...inspectionWithoutJoin } = inspection as any;
    
    // Step 1: Upsert inspection
    steps.push({
      table: 'inspections',
      operation: 'upsert',
      data: {
        ...inspectionWithoutJoin,
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
 * Helper function to transform temp- IDs to valid UUIDs
 */
function transformTempIds<T extends { id?: string }>(items: T[]): T[] {
  return items.map(item => ({
    ...item,
    id: item.id?.startsWith('temp-') ? crypto.randomUUID() : item.id
  }));
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
    
    // Verify current user matches inspector_id
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("User not authenticated");
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
      console.log('[Atomic Sync] Training validation passed for:', trainingId);
    }
    
    // 3. Check for conflicts
    const { data: remoteTraining } = await supabase
      .from("trainings")
      .select("updated_at")
      .eq("id", trainingId)
      .maybeSingle();
    
    if (remoteTraining) {
      const remoteUpdated = new Date(remoteTraining.updated_at).getTime();
      const localUpdated = new Date(training.updated_at).getTime();
      const timeDiff = Math.abs(remoteUpdated - localUpdated);
      
      if (timeDiff > 5000 && remoteUpdated > localUpdated) {
        console.warn('[Atomic Sync] Training conflict detected:', trainingId);
        // For trainings, we log the warning but continue with local-wins strategy
        // since trainings don't have a sync_conflicts table reference
        toast.warning("Training Sync Notice", {
          description: `Training data may have been modified elsewhere. Local changes applied.`,
          duration: 5000,
        });
      }
    }
    
    // 4. Build transaction steps
    const steps: TransactionStep[] = [];
    
    // Exclude joined objects - only column fields exist in DB
    const { inspector, trainer, ...trainingWithoutJoin } = training as any;
    
    // Step 1: Upsert training
    steps.push({
      table: 'trainings',
      operation: 'upsert',
      data: {
        ...trainingWithoutJoin,
        synced_at: new Date().toISOString(),
      },
      rollbackData: remoteTraining || null,
    });
    
    // Step 2: Delete existing related data (to handle deletions)
    if (remoteTraining) {
      steps.push(
        { table: 'training_delivery_approaches', operation: 'delete', filter: { training_id: trainingId } },
        { table: 'training_operating_systems', operation: 'delete', filter: { training_id: trainingId } },
        { table: 'training_immediate_attention', operation: 'delete', filter: { training_id: trainingId } },
        { table: 'training_verifiable_items', operation: 'delete', filter: { training_id: trainingId } },
        { table: 'training_systems_in_place', operation: 'delete', filter: { training_id: trainingId } },
        { table: 'training_summary', operation: 'delete', filter: { training_id: trainingId } }
      );
    }
    
    // Step 3: Insert all related data
    if (delivery_approaches.length > 0) {
      delivery_approaches.forEach(approach => {
        steps.push({
          table: 'training_delivery_approaches',
          operation: 'insert',
          data: approach,
        });
      });
    }
    
    if (operating_systems.length > 0) {
      operating_systems.forEach(system => {
        steps.push({
          table: 'training_operating_systems',
          operation: 'insert',
          data: system,
        });
      });
    }
    
    if (immediate_attention.length > 0) {
      immediate_attention.forEach(item => {
        steps.push({
          table: 'training_immediate_attention',
          operation: 'insert',
          data: item,
        });
      });
    }
    
    if (verifiable_items.length > 0) {
      verifiable_items.forEach(item => {
        steps.push({
          table: 'training_verifiable_items',
          operation: 'insert',
          data: item,
        });
      });
    }
    
    if (systems_in_place.length > 0) {
      systems_in_place.forEach(item => {
        steps.push({
          table: 'training_systems_in_place',
          operation: 'insert',
          data: item,
        });
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
        data: sanitizedSummary,
      });
    }
    
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
      console.log('[Atomic Sync] Successfully synced training:', trainingId);
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
  
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Offline - skipping training sync');
    }
    return;
  }
  
  // Get current user to filter trainings
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("User not authenticated");
  }
  
  // Only get unsynced trainings for the current user
  const unsynced = await getUnsyncedTrainings(user.id);
  
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
  
  // Mobile devices get retry logic
  const maxRetries = capabilities.isMobile ? 3 : 1;
  
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
        await syncTrainingAtomic(training.id);
        successCount++;
        synced = true;
        
        if (import.meta.env.DEV) {
          console.log(`[Atomic Sync] Synced training ${i + 1}/${unsynced.length}:`, training.id);
        }
      } catch (error: any) {
        retryCount++;
        
        if (retryCount < maxRetries) {
          // Exponential backoff for retries
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
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
    
    // Verify current user matches inspector_id
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("User not authenticated");
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
      console.log('[Atomic Sync] Daily assessment validation passed for:', assessmentId);
    }
    
    // 3. Check for conflicts
    const { data: remoteAssessment } = await supabase
      .from("daily_assessments")
      .select("updated_at")
      .eq("id", assessmentId)
      .maybeSingle();
    
    if (remoteAssessment) {
      const remoteUpdated = new Date(remoteAssessment.updated_at).getTime();
      const localUpdated = new Date(assessment.updated_at).getTime();
      const timeDiff = Math.abs(remoteUpdated - localUpdated);
      
      if (timeDiff > 5000 && remoteUpdated > localUpdated) {
        console.warn('[Atomic Sync] Daily assessment conflict detected:', assessmentId);
        toast.warning("Assessment Sync Notice", {
          description: `Assessment data may have been modified elsewhere. Local changes applied.`,
          duration: 5000,
        });
      }
    }
    
    // 4. Build transaction steps
    const steps: TransactionStep[] = [];
    
    // Exclude joined objects - only column fields exist in DB
    const { inspector, ...assessmentWithoutJoin } = assessment as any;
    
    // Step 1: Upsert assessment
    steps.push({
      table: 'daily_assessments',
      operation: 'upsert',
      data: {
        ...assessmentWithoutJoin,
        synced_at: new Date().toISOString(),
      },
      rollbackData: remoteAssessment || null,
    });
    
    // Step 2: Delete existing related data (to handle deletions)
    if (remoteAssessment) {
      steps.push(
        { table: 'daily_assessment_beginning_of_day', operation: 'delete', filter: { assessment_id: assessmentId } },
        { table: 'daily_assessment_end_of_day', operation: 'delete', filter: { assessment_id: assessmentId } },
        { table: 'daily_assessment_operating_systems', operation: 'delete', filter: { assessment_id: assessmentId } },
        { table: 'daily_assessment_equipment_checks', operation: 'delete', filter: { assessment_id: assessmentId } },
        { table: 'daily_assessment_structure_checks', operation: 'delete', filter: { assessment_id: assessmentId } },
        { table: 'daily_assessment_environment_checks', operation: 'delete', filter: { assessment_id: assessmentId } }
      );
    }
    
    // Step 3: Insert all related data
    if (beginning_of_day.length > 0) {
      beginning_of_day.forEach(item => {
        steps.push({
          table: 'daily_assessment_beginning_of_day',
          operation: 'insert',
          data: item,
        });
      });
    }
    
    if (end_of_day.length > 0) {
      end_of_day.forEach(item => {
        steps.push({
          table: 'daily_assessment_end_of_day',
          operation: 'insert',
          data: item,
        });
      });
    }
    
    if (operating_systems.length > 0) {
      operating_systems.forEach(system => {
        steps.push({
          table: 'daily_assessment_operating_systems',
          operation: 'insert',
          data: system,
        });
      });
    }
    
    if (equipment_checks.length > 0) {
      equipment_checks.forEach(check => {
        steps.push({
          table: 'daily_assessment_equipment_checks',
          operation: 'insert',
          data: check,
        });
      });
    }
    
    if (structure_checks.length > 0) {
      structure_checks.forEach(check => {
        steps.push({
          table: 'daily_assessment_structure_checks',
          operation: 'insert',
          data: check,
        });
      });
    }
    
    if (environment_checks.length > 0) {
      environment_checks.forEach(check => {
        steps.push({
          table: 'daily_assessment_environment_checks',
          operation: 'insert',
          data: check,
        });
      });
    }
    
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
      console.log('[Atomic Sync] Successfully synced daily assessment:', assessmentId);
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
  
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      console.log('[Atomic Sync] Offline - skipping daily assessment sync');
    }
    return;
  }
  
  // Get current user to filter assessments
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("User not authenticated");
  }
  
  // Only get unsynced assessments for the current user
  const unsynced = await getUnsyncedDailyAssessments(user.id);
  
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
  
  // Mobile devices get retry logic
  const maxRetries = capabilities.isMobile ? 3 : 1;
  
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
        await syncDailyAssessmentAtomic(assessment.id);
        successCount++;
        synced = true;
        
        if (import.meta.env.DEV) {
          console.log(`[Atomic Sync] Synced daily assessment ${i + 1}/${unsynced.length}:`, assessment.id);
        }
      } catch (error: any) {
        retryCount++;
        
        if (retryCount < maxRetries) {
          // Exponential backoff for retries
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
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
