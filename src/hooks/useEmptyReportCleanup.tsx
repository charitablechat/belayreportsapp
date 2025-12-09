import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
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
}

/**
 * Hook to check if a report is empty and should be cleaned up when navigating away.
 * Returns a function to check emptiness and handle cleanup.
 */
export function useEmptyReportCleanup({
  type,
  id,
  status,
  data,
  relatedData = {}
}: UseEmptyReportCleanupOptions) {
  const cleanupAttempted = useRef(false);

  const checkIsEmpty = useCallback(() => {
    if (!data || !id) return true;

    switch (type) {
      case 'inspection':
        return isInspectionEmpty(
          data,
          relatedData.systems || [],
          relatedData.ziplines || [],
          relatedData.equipment || [],
          relatedData.standards || [],
          relatedData.summary
        );
      case 'training':
        return isTrainingEmpty(
          data,
          relatedData.deliveryApproaches || [],
          relatedData.operatingSystems || [],
          relatedData.immediateAttention || [],
          relatedData.verifiableItems || [],
          relatedData.systemsInPlace || [],
          relatedData.summary
        );
      case 'daily_assessment':
        return isDailyAssessmentEmpty(
          data,
          relatedData.beginningOfDay || [],
          relatedData.endOfDay || [],
          relatedData.environmentChecks || [],
          relatedData.equipmentChecks || [],
          relatedData.structureChecks || [],
          relatedData.operatingSystems || []
        );
      default:
        return true;
    }
  }, [type, data, id, relatedData]);

  const cleanupEmptyReport = useCallback(async (): Promise<boolean> => {
    if (!id || cleanupAttempted.current) return false;
    
    const isEmpty = checkIsEmpty();
    const shouldDelete = shouldDeleteEmptyReport(status, isEmpty);
    
    if (!shouldDelete) return false;

    cleanupAttempted.current = true;
    
    try {
      // Delete from Supabase if online
      if (navigator.onLine) {
        let error: any = null;
        
        switch (type) {
          case 'inspection':
            const inspResult = await supabase.from('inspections').delete().eq('id', id);
            error = inspResult.error;
            break;
          case 'training':
            const trainResult = await supabase.from('trainings').delete().eq('id', id);
            error = trainResult.error;
            break;
          case 'daily_assessment':
            const assessResult = await supabase.from('daily_assessments').delete().eq('id', id);
            error = assessResult.error;
            break;
        }

        if (error) {
          console.error(`Error deleting empty ${type}:`, error);
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
        console.log(`[EmptyReportCleanup] Deleted empty ${type}: ${id}`);
      }
      
      return true;
    } catch (error) {
      console.error(`Error cleaning up empty ${type}:`, error);
      cleanupAttempted.current = false;
      return false;
    }
  }, [id, status, type, checkIsEmpty]);

  return {
    checkIsEmpty,
    cleanupEmptyReport,
    shouldCleanup: shouldDeleteEmptyReport(status, checkIsEmpty())
  };
}
