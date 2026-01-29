import { useEffect, useCallback, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { syncAllInspectionsAtomic, syncAllTrainingsAtomic, syncAllDailyAssessmentsAtomic } from '@/lib/atomic-sync-manager';
import { syncPhotos } from '@/lib/sync-manager';
import { getUnsyncedInspections, getUnsyncedTrainings, getUnsyncedDailyAssessments } from '@/lib/offline-storage';
import { getUserWithCache } from '@/lib/cached-auth';
import { useQueryClient } from '@tanstack/react-query';
import { isMobile, isIOS } from '@/lib/mobile-detection';

// Sync configuration
const DEBOUNCE_DELAY = 3000; // 3 seconds after local changes
const PERIODIC_SYNC_INTERVAL = 30000; // 30 seconds fallback polling
const MIN_SYNC_INTERVAL = 5000; // Minimum 5 seconds between syncs
const INITIAL_SYNC_DELAY = 2000; // 2 seconds delay for initial sync to not block UI

export interface AutoSyncState {
  isSyncing: boolean;
  lastSyncTime: Date | null;
  unsyncedCount: number;
  unsyncedPhotoCount: number;
}

/**
 * Unified hook for fully automatic background synchronization
 * - Debounced sync after local data changes
 * - Immediate sync on network reconnection
 * - Sync on app visibility changes
 * - Periodic polling as fallback
 * - Realtime subscriptions for multi-device sync
 */
export const useAutoSync = () => {
  const queryClient = useQueryClient();
  const isMobileDevice = isMobile();
  const isIOSDevice = isIOS();
  
  const [state, setState] = useState<AutoSyncState>({
    isSyncing: false,
    lastSyncTime: null,
    unsyncedCount: 0,
    unsyncedPhotoCount: 0,
  });
  
  // Refs for debouncing and preventing duplicate syncs
  const lastSyncAttemptRef = useRef<number>(0);
  const syncInProgressRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const periodicSyncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  
  /**
   * Perform the actual sync operation
   */
  const performSync = useCallback(async (silent = true) => {
    // Skip if offline
    if (!navigator.onLine) {
      if (import.meta.env.DEV) {
        console.log('[AutoSync] Offline - skipping sync');
      }
      return;
    }
    
    // Prevent duplicate sync calls
    if (syncInProgressRef.current) {
      if (import.meta.env.DEV) {
        console.log('[AutoSync] Sync already in progress - skipping');
      }
      return;
    }
    
    // Debounce protection
    const now = Date.now();
    if (now - lastSyncAttemptRef.current < MIN_SYNC_INTERVAL) {
      if (import.meta.env.DEV) {
        console.log('[AutoSync] Too soon since last sync - debouncing');
      }
      return;
    }
    
    lastSyncAttemptRef.current = now;
    syncInProgressRef.current = true;
    setState(prev => ({ ...prev, isSyncing: true }));
    
    try {
      if (import.meta.env.DEV) {
        console.log('[AutoSync] Starting sync...');
      }
      
      // Sync all data types in parallel
      await Promise.all([
        syncAllInspectionsAtomic(),
        syncAllTrainingsAtomic(),
        syncAllDailyAssessmentsAtomic(),
        syncPhotos(),
      ]);
      
      // Update state
      setState(prev => ({
        ...prev,
        isSyncing: false,
        lastSyncTime: new Date(),
      }));
      
      // Refresh unsynced counts
      await updateUnsyncedCounts();
      
      // Invalidate queries to refresh UI
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      queryClient.invalidateQueries({ queryKey: ['trainings'] });
      queryClient.invalidateQueries({ queryKey: ['daily-assessments'] });
      
      if (import.meta.env.DEV) {
        console.log('[AutoSync] Sync completed successfully');
      }
    } catch (error) {
      console.error('[AutoSync] Sync failed:', error);
      setState(prev => ({ ...prev, isSyncing: false }));
    } finally {
      syncInProgressRef.current = false;
    }
  }, [queryClient]);
  
  /**
   * Update unsynced counts from IndexedDB - uses cached auth
   */
  const updateUnsyncedCounts = useCallback(async () => {
    try {
      const user = await getUserWithCache();
      if (!user) return;
      
      const [inspections, trainings, assessments] = await Promise.all([
        getUnsyncedInspections(user.id),
        getUnsyncedTrainings(user.id),
        getUnsyncedDailyAssessments(user.id),
      ]);
      
      const total = inspections.length + trainings.length + assessments.length;
      
      setState(prev => ({
        ...prev,
        unsyncedCount: total,
      }));
      
      if (import.meta.env.DEV && total > 0) {
        console.log('[AutoSync] Unsynced count:', total);
      }
    } catch (error) {
      console.error('[AutoSync] Error updating unsynced counts:', error);
    }
  }, []);
  
  /**
   * Debounced sync trigger - call this after local data changes
   */
  const triggerDebouncedSync = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    debounceTimerRef.current = setTimeout(() => {
      performSync(true);
    }, DEBOUNCE_DELAY);
  }, [performSync]);
  
  /**
   * Handle online event - sync immediately when network reconnects
   */
  const handleOnline = useCallback(() => {
    if (import.meta.env.DEV) {
      console.log('[AutoSync] Network reconnected - syncing immediately');
    }
    performSync(false);
  }, [performSync]);
  
  /**
   * Handle visibility change - sync when app becomes visible
   */
  const handleVisibilityChange = useCallback(() => {
    if (!document.hidden && navigator.onLine) {
      if (import.meta.env.DEV) {
        console.log('[AutoSync] App became visible - syncing');
      }
      performSync(true);
    }
  }, [performSync]);
  
  /**
   * Handle Realtime database changes from other devices
   */
  const handleRemoteChange = useCallback((payload: any) => {
    if (import.meta.env.DEV) {
      console.log('[AutoSync] Realtime change detected:', payload.eventType, payload.table);
    }
    
    // Invalidate relevant queries to refresh UI with remote data
    if (payload.table === 'inspections') {
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
    } else if (payload.table === 'trainings') {
      queryClient.invalidateQueries({ queryKey: ['trainings'] });
    } else if (payload.table === 'daily_assessments') {
      queryClient.invalidateQueries({ queryKey: ['daily-assessments'] });
    }
    
    // Trigger a sync to reconcile any local changes
    triggerDebouncedSync();
  }, [queryClient, triggerDebouncedSync]);
  
  // Initialize sync system
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[AutoSync] Initializing automatic sync system', {
        isMobile: isMobileDevice,
        isIOS: isIOSDevice,
      });
    }
    
    // PERFORMANCE: Defer initial sync to not block UI render
    // Dashboard data loads from Supabase directly, sync is for reconciliation
    const initialSyncTimer = setTimeout(() => {
      if (navigator.onLine) {
        performSync(true);
      }
      updateUnsyncedCounts();
    }, INITIAL_SYNC_DELAY);
    
    // Event listeners
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // iOS-specific: Handle page show (back/forward cache restore)
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && navigator.onLine) {
        if (import.meta.env.DEV) {
          console.log('[AutoSync] Page restored from bfcache - syncing');
        }
        performSync(true);
      }
    };
    
    if (isIOSDevice) {
      window.addEventListener('pageshow', handlePageShow);
      window.addEventListener('focus', () => {
        if (navigator.onLine) performSync(true);
      });
    }
    
    // Periodic sync polling
    periodicSyncIntervalRef.current = setInterval(() => {
      if (!document.hidden && navigator.onLine) {
        performSync(true);
      }
    }, PERIODIC_SYNC_INTERVAL);
    
    // Realtime subscriptions for multi-device sync
    channelRef.current = supabase
      .channel('global-auto-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'inspections' },
        handleRemoteChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trainings' },
        handleRemoteChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_assessments' },
        handleRemoteChange
      )
      .subscribe((status) => {
        if (import.meta.env.DEV) {
          console.log('[AutoSync] Realtime subscription status:', status);
        }
      });
    
    return () => {
      // Cleanup
      clearTimeout(initialSyncTimer);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      
      if (isIOSDevice) {
        window.removeEventListener('pageshow', handlePageShow);
      }
      
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      
      if (periodicSyncIntervalRef.current) {
        clearInterval(periodicSyncIntervalRef.current);
      }
      
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [performSync, handleOnline, handleVisibilityChange, handleRemoteChange, updateUnsyncedCounts, isIOSDevice, isMobileDevice]);
  
  // Periodically update unsynced counts
  useEffect(() => {
    const interval = setInterval(updateUnsyncedCounts, 30000);
    return () => clearInterval(interval);
  }, [updateUnsyncedCounts]);
  
  return {
    ...state,
    triggerDebouncedSync,
    updateUnsyncedCounts,
    performSync,
  };
};
