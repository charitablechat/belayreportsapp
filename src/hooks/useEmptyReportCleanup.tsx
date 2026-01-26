import { useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { addDays } from "date-fns";
import { 
  isInspectionEmpty, 
  isTrainingEmpty, 
  isDailyAssessmentEmpty,
  shouldDeleteEmptyReport 
} from "@/lib/report-utils";
import {
  deleteOfflineInspection,
  deleteOfflineTraining,
  deleteOfflineDailyAssessment
} from "@/lib/offline-storage";

interface UseEmptyReportCleanupOptions {
  type: 'inspection' | 'training' | 'daily_assessment';
  id: string | undefined;
  status: string | undefined;
  data: any;
  userId?: string | undefined;
  relatedData?: {
    systems?: any[];
    ziplines?: any[];
    equipment?: any[];
    standards?: any[];
    summary?: any;
    deliveryApproaches?: any[];
    operatingSystems?: any[];
    immediateAttention?: any[];
    verifiableItems?: any[];
    systemsInPlace?: any[];
    beginningOfDay?: any[];
    endOfDay?: any[];
    environmentChecks?: any[];
    equipmentChecks?: any[];
    structureChecks?: any[];
  };
  /** If true, skip cleanup entirely (user has interacted with the form) */
  hasUserInteracted?: boolean;
}

/**
 * Hook to check if a report is empty and should be cleaned up when navigating away.
 * Returns a function to check emptiness and handle cleanup.
 * 
 * IMPORTANT: Uses refs internally to avoid stale closure issues in cleanup effects.
 * 
 * NOTE: Empty report cleanup now uses SOFT DELETE (sets deleted_at, deleted_by, retention_until)
 * instead of hard delete. This allows recovery within 60 days.
 */
export function useEmptyReportCleanup({
  type,
  id,
  status,
  data,
  userId,
  relatedData = {},
  hasUserInteracted = false
}: UseEmptyReportCleanupOptions) {
  const cleanupAttempted = useRef(false);
  
  // Use refs to always have current values - prevents stale closure bug
  const dataRef = useRef(data);
  const statusRef = useRef(status);
  const userIdRef = useRef(userId);
  const relatedDataRef = useRef(relatedData);
  const hasUserInteractedRef = useRef(hasUserInteracted);
  
  // Update refs whenever props change
  useEffect(() => {
    dataRef.current = data;
    statusRef.current = status;
    userIdRef.current = userId;
    relatedDataRef.current = relatedData;
    hasUserInteractedRef.current = hasUserInteracted;
  }, [data, status, userId, relatedData, hasUserInteracted]);

  const checkIsEmpty = useCallback(() => {
    const currentData = dataRef.current;
    const currentRelatedData = relatedDataRef.current;
    
    if (!currentData || !id) return true;

    switch (type) {
      case 'inspection':
        return isInspectionEmpty(
          currentData,
          currentRelatedData.systems || [],
          currentRelatedData.ziplines || [],
          currentRelatedData.equipment || [],
          currentRelatedData.standards || [],
          currentRelatedData.summary
        );
      case 'training':
        return isTrainingEmpty(
          currentData,
          currentRelatedData.deliveryApproaches || [],
          currentRelatedData.operatingSystems || [],
          currentRelatedData.immediateAttention || [],
          currentRelatedData.verifiableItems || [],
          currentRelatedData.systemsInPlace || [],
          currentRelatedData.summary
        );
      case 'daily_assessment':
        return isDailyAssessmentEmpty(
          currentData,
          currentRelatedData.beginningOfDay || [],
          currentRelatedData.endOfDay || [],
          currentRelatedData.environmentChecks || [],
          currentRelatedData.equipmentChecks || [],
          currentRelatedData.structureChecks || [],
          currentRelatedData.operatingSystems || []
        );
      default:
        return true;
    }
  }, [type, id]);

  const cleanupEmptyReport = useCallback(async (): Promise<boolean> => {
    if (!id || cleanupAttempted.current) return false;
    
    // Skip cleanup if user has interacted with the form
    if (hasUserInteractedRef.current) {
      if (import.meta.env.DEV) {
        console.log(`[EmptyReportCleanup] Skipping cleanup - user has interacted with form`);
      }
      return false;
    }
    
    const isEmpty = checkIsEmpty();
    const currentStatus = statusRef.current;
    const currentUserId = userIdRef.current;
    const shouldDelete = shouldDeleteEmptyReport(currentStatus, isEmpty);
    
    if (import.meta.env.DEV) {
      console.log(`[EmptyReportCleanup] Check: isEmpty=${isEmpty}, status=${currentStatus}, shouldDelete=${shouldDelete}`);
    }
    
    if (!shouldDelete) return false;

    cleanupAttempted.current = true;
    
    // Prepare soft-delete data
    const now = new Date();
    const retentionUntil = addDays(now, 60);
    const softDeleteData = {
      deleted_at: now.toISOString(),
      deleted_by: currentUserId || null,
      retention_until: retentionUntil.toISOString(),
    };
    
    // Map type to table name
    const tableMap = {
      'inspection': 'inspections',
      'training': 'trainings',
      'daily_assessment': 'daily_assessments',
    } as const;
    const tableName = tableMap[type];
    
    try {
      // Soft-delete from Supabase if online (UPDATE instead of DELETE)
      if (navigator.onLine) {
        const { error } = await supabase
          .from(tableName)
          .update(softDeleteData)
          .eq('id', id);

        if (error) {
          console.error(`Error soft-deleting empty ${type}:`, error);
          cleanupAttempted.current = false;
          return false;
        }
      }

      // Delete from offline storage
      switch (type) {
        case 'inspection':
          await deleteOfflineInspection(id);
          break;
        case 'training':
          await deleteOfflineTraining(id);
          break;
        case 'daily_assessment':
          await deleteOfflineDailyAssessment(id);
          break;
      }

      if (import.meta.env.DEV) {
        console.log(`[EmptyReportCleanup] Soft-deleted empty ${type}: ${id}`);
      }
      
      return true;
    } catch (error) {
      console.error(`Error cleaning up empty ${type}:`, error);
      cleanupAttempted.current = false;
      return false;
    }
  }, [id, type, checkIsEmpty]);

  return {
    checkIsEmpty,
    cleanupEmptyReport,
    shouldCleanup: shouldDeleteEmptyReport(status, checkIsEmpty())
  };
}
