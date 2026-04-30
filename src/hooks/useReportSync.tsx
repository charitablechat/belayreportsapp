/**
 * useReportSync Hook
 * 
 * Provides automatic report syncing functionality with realtime updates.
 * 
 * DESIGN APPROACH ("Latest Pointer"):
 * - Each entity (inspection, training, assessment) stores its latest_report_html,
 *   latest_report_generated_at, and report_version directly in its row.
 * - This is atomic: a single UPDATE sets all fields or none.
 * - report_version increments monotonically, preventing stale overwrites.
 * - Realtime subscriptions via Supabase allow the UI to auto-refresh.
 * 
 * OFFLINE HANDLING:
 * - Reports are cached in localStorage for offline access.
 * - Failed syncs are retried with exponential backoff.
 * - A queue tracks pending report syncs.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNetworkStatus } from './useNetworkStatus';
import { useFormRecordRealtime } from './useFormRecordRealtime';
import { syncLog } from '@/lib/sync-logger';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { DbRow } from '@/lib/offline-storage';

export type ReportType = 'inspection' | 'training' | 'daily_assessment';

export interface ReportSyncState {
  isSyncing: boolean;
  isSynced: boolean;
  lastSyncedAt: Date | null;
  reportVersion: number;
  error: string | null;
  hasLatestReport: boolean;
}

interface ReportSyncResult {
  success: boolean;
  version: number;
  generatedAt: Date;
  error?: string;
}

interface PendingReportSync {
  entityId: string;
  reportType: ReportType;
  html: string;
  timestamp: number;
  retries: number;
}

const REPORT_SYNC_QUEUE_KEY = 'report_sync_queue';
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 10000]; // Exponential backoff

// Get the table name for a report type
const getTableName = (reportType: ReportType): 'inspections' | 'trainings' | 'daily_assessments' => {
  switch (reportType) {
    case 'inspection': return 'inspections';
    case 'training': return 'trainings';
    case 'daily_assessment': return 'daily_assessments';
  }
};

// Load pending syncs from localStorage
const loadPendingSyncs = (): PendingReportSync[] => {
  try {
    const data = localStorage.getItem(REPORT_SYNC_QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

// Save pending syncs to localStorage
const savePendingSyncs = (syncs: PendingReportSync[]): void => {
  // Lazy import to avoid pulling deps into module init
  import('@/lib/safe-local-storage').then(({ safeSetItem }) => {
    safeSetItem(REPORT_SYNC_QUEUE_KEY, JSON.stringify(syncs), {
      scope: 'report-sync.queue',
      critical: false,
    });
  }).catch((e) => {
    console.error('[ReportSync] Failed to save pending syncs:', e);
  });
};

// Add a sync to the queue
const queueReportSync = (entityId: string, reportType: ReportType, html: string): void => {
  const pending = loadPendingSyncs();
  
  // Remove any existing sync for this entity (we only want the latest)
  const filtered = pending.filter(
    s => !(s.entityId === entityId && s.reportType === reportType)
  );
  
  filtered.push({
    entityId,
    reportType,
    html,
    timestamp: Date.now(),
    retries: 0,
  });
  
  savePendingSyncs(filtered);
  syncLog.log('[ReportSync] Queued report sync:', { entityId, reportType });
};

// Remove a sync from the queue
const removeFromQueue = (entityId: string, reportType: ReportType): void => {
  const pending = loadPendingSyncs();
  const filtered = pending.filter(
    s => !(s.entityId === entityId && s.reportType === reportType)
  );
  savePendingSyncs(filtered);
};

/**
 * Sync a report to the database atomically.
 * Updates latest_report_html, latest_report_generated_at, and increments report_version.
 */
export const syncReportToDatabase = async (
  entityId: string,
  reportType: ReportType,
  html: string,
  currentVersion: number = 0
): Promise<ReportSyncResult> => {
  const tableName = getTableName(reportType);
  const generatedAt = new Date();
  const newVersion = currentVersion + 1;
  
  try {
    // Atomic update of all report fields
    // Using 'as any' because the types.ts hasn't been regenerated for the new columns
    const { error: updateError } = await supabase
      .from(tableName)
      .update({
        latest_report_html: html,
        latest_report_generated_at: generatedAt.toISOString(),
        report_version: newVersion,
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', entityId);
    
    if (updateError) throw updateError;
    
    syncLog.log('[ReportSync] Successfully synced report:', { 
      entityId, 
      reportType, 
      version: newVersion 
    });
    
    // Remove from queue if it was pending
    removeFromQueue(entityId, reportType);
    
    return {
      success: true,
      version: newVersion,
      generatedAt,
    };
  } catch (error: any) {
    console.error('[ReportSync] Failed to sync report:', error);
    return {
      success: false,
      version: currentVersion,
      generatedAt,
      error: error.message || 'Failed to sync report',
    };
  }
};

/**
 * Hook for managing report sync state with realtime updates.
 */
export const useReportSync = (entityId: string | undefined, reportType: ReportType) => {
  const { isOnline } = useNetworkStatus();
  const [state, setState] = useState<ReportSyncState>({
    isSyncing: false,
    isSynced: false,
    lastSyncedAt: null,
    reportVersion: 0,
    error: null,
    hasLatestReport: false,
  });
  
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load initial / refresh state from database. Hoisted out of the initial-load
  // useEffect so the H2 Realtime resume-or-degraded callback can reuse it.
  const refreshFromDatabase = useCallback(async () => {
    if (!entityId) return;
    const tableName = getTableName(reportType);
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .eq('id', entityId)
      .single();
    if (!error && data) {
      const record = data as Record<string, unknown>;
      const generatedAt = typeof record.latest_report_generated_at === 'string'
        ? new Date(record.latest_report_generated_at)
        : null;
      const version = typeof record.report_version === 'number' ? record.report_version : 0;
      const html = record.latest_report_html;
      setState(prev => ({
        ...prev,
        hasLatestReport: !!html,
        lastSyncedAt: generatedAt,
        reportVersion: version,
        isSynced: !!html,
      }));
    }
  }, [entityId, reportType]);

  useEffect(() => {
    refreshFromDatabase();
  }, [refreshFromDatabase]);

  // Audit H2: Realtime now goes through the shared helper which adds
  // CHANNEL_ERROR/TIMED_OUT/CLOSED fallback refetch + app-resume
  // resubscribe so a dead websocket on iPad bfcache/handoff doesn't leave
  // the report card showing stale `Synced` state.
  const tableName = entityId ? getTableName(reportType) : 'inspections';
  useFormRecordRealtime({
    enabled: !!entityId,
    channelName: entityId ? `report-sync-${entityId}` : '',
    table: tableName,
    recordId: entityId || '',
    logTag: 'ReportSync',
    onUpdate: (payload: RealtimePostgresChangesPayload<DbRow>) => {
      const newData = payload.new as Record<string, unknown> | null;
      if (!newData) return;
      const incomingVersion = typeof newData.report_version === 'number' ? newData.report_version : 0;
      // Compare against the ref so we always see the latest version. The
      // helper's callback-ref pattern means this closure is the latest
      // render's, so reading state via the closure is also fine.
      if (incomingVersion > state.reportVersion) {
        syncLog.log('[ReportSync] Realtime update received:', { entityId, newVersion: incomingVersion });
        const generatedAt = typeof newData.latest_report_generated_at === 'string'
          ? new Date(newData.latest_report_generated_at)
          : null;
        setState(prev => ({
          ...prev,
          hasLatestReport: !!newData.latest_report_html,
          lastSyncedAt: generatedAt,
          reportVersion: incomingVersion,
          isSynced: true,
          isSyncing: false,
          error: null,
        }));
      }
    },
    onResumeOrDegraded: () => {
      // Refetch the row so we pick up any UPDATE events we missed while the
      // websocket was dead.
      refreshFromDatabase();
    },
  });

  // Process pending syncs when coming back online
  useEffect(() => {
    if (!isOnline || !entityId) return;
    
    const processPendingSyncs = async () => {
      const pending = loadPendingSyncs();
      const relevantSyncs = pending.filter(
        s => s.entityId === entityId && s.reportType === reportType
      );
      
      for (const sync of relevantSyncs) {
        if (sync.retries >= MAX_RETRIES) {
          console.warn('[ReportSync] Max retries reached, removing from queue:', sync);
          removeFromQueue(sync.entityId, sync.reportType);
          continue;
        }
        
        syncLog.log('[ReportSync] Processing pending sync:', sync);
        setState(prev => ({ ...prev, isSyncing: true }));
        
        const result = await syncReportToDatabase(
          sync.entityId,
          sync.reportType,
          sync.html,
          state.reportVersion
        );
        
        if (result.success) {
          setState(prev => ({
            ...prev,
            isSyncing: false,
            isSynced: true,
            lastSyncedAt: result.generatedAt,
            reportVersion: result.version,
            hasLatestReport: true,
            error: null,
          }));
        } else {
          // Update retry count
          const updated = loadPendingSyncs().map(s => 
            s.entityId === sync.entityId && s.reportType === sync.reportType
              ? { ...s, retries: s.retries + 1 }
              : s
          );
          savePendingSyncs(updated);
          
          setState(prev => ({ ...prev, isSyncing: false, error: result.error || null }));
          
          // Schedule retry with backoff
          const delay = RETRY_DELAYS[Math.min(sync.retries, RETRY_DELAYS.length - 1)];
          retryTimeoutRef.current = setTimeout(processPendingSyncs, delay);
        }
      }
    };
    
    processPendingSyncs();
    
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [isOnline, entityId, reportType, state.reportVersion]);

  /**
   * Sync a report - handles both online and offline cases.
   * Returns immediately if offline (queues for later sync).
   */
  const syncReport = useCallback(async (html: string): Promise<ReportSyncResult> => {
    if (!entityId) {
      return { success: false, version: 0, generatedAt: new Date(), error: 'No entity ID' };
    }
    
    setState(prev => ({ ...prev, isSyncing: true, error: null }));
    
    if (!isOnline) {
      // Queue for later sync
      queueReportSync(entityId, reportType, html);
      
      setState(prev => ({
        ...prev,
        isSyncing: false,
        error: 'Offline - report queued for sync',
      }));
      
      return {
        success: false,
        version: state.reportVersion,
        generatedAt: new Date(),
        error: 'Offline - queued for sync',
      };
    }
    
    const result = await syncReportToDatabase(entityId, reportType, html, state.reportVersion);
    
    setState(prev => ({
      ...prev,
      isSyncing: false,
      isSynced: result.success,
      lastSyncedAt: result.success ? result.generatedAt : prev.lastSyncedAt,
      reportVersion: result.success ? result.version : prev.reportVersion,
      hasLatestReport: result.success ? true : prev.hasLatestReport,
      error: result.error || null,
    }));
    
    return result;
  }, [entityId, reportType, isOnline, state.reportVersion]);

  /**
   * Get the latest report HTML from the database.
   */
  const getLatestReport = useCallback(async (): Promise<string | null> => {
    if (!entityId) return null;
    
    const tableName = getTableName(reportType);
    
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .eq('id', entityId)
      .single();
    
    if (error || !data) {
      console.error('[ReportSync] Failed to get latest report:', error);
      return null;
    }
    
    return (data as any).latest_report_html;
  }, [entityId, reportType]);

  return {
    ...state,
    syncReport,
    getLatestReport,
  };
};

export default useReportSync;
