import { useState, useEffect, useCallback, useRef } from 'react';
import { getUnsyncedInspections } from '@/lib/offline-storage';
import { syncAllInspectionsAtomic } from '@/lib/atomic-sync-manager';
import { useNetworkStatus } from './useNetworkStatus';
import { supabase } from '@/integrations/supabase/client';

export interface SyncStatus {
  unsyncedCount: number;
  unsyncedInspections: any[];
  isSyncing: boolean;
  lastSyncTime: Date | null;
  syncError: string | null;
}

// Minimum interval between sync attempts to prevent rapid-fire syncs
const MIN_SYNC_INTERVAL = 5000; // 5 seconds

export const useSyncStatus = () => {
  const { isOnline } = useNetworkStatus();
  const lastSyncAttemptRef = useRef<number>(0);
  
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    unsyncedCount: 0,
    unsyncedInspections: [],
    isSyncing: false,
    lastSyncTime: null,
    syncError: null,
  });

  const updateUnsyncedCount = useCallback(async () => {
    try {
      // Get current user to filter inspections
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('[Sync Status] No authenticated user');
        return;
      }
      
      // Only get unsynced inspections for the current user
      const unsynced = await getUnsyncedInspections(user.id);
      setSyncStatus(prev => ({
        ...prev,
        unsyncedCount: unsynced.length,
        unsyncedInspections: unsynced,
      }));

      if (import.meta.env.DEV) {
        console.log('[Sync Status] Unsynced count updated:', unsynced.length);
      }
    } catch (error) {
      console.error('[Sync Status] Error getting unsynced count:', error);
    }
  }, []);

  const triggerSync = useCallback(async () => {
    if (!isOnline) {
      console.log('[Sync Status] Cannot sync while offline');
      return;
    }
    
    if (syncStatus.isSyncing) {
      console.log('[Sync Status] Sync already in progress');
      return;
    }

    // Debounce protection - prevent rapid-fire sync attempts
    const now = Date.now();
    if (now - lastSyncAttemptRef.current < MIN_SYNC_INTERVAL) {
      if (import.meta.env.DEV) {
        console.log('[Sync Status] Debounced - too soon since last sync attempt');
      }
      return;
    }
    lastSyncAttemptRef.current = now;

    setSyncStatus(prev => ({ ...prev, isSyncing: true, syncError: null }));

    if (import.meta.env.DEV) {
      console.log('[Sync Status] Sync triggered manually');
    }

    try {
      await syncAllInspectionsAtomic();
      setSyncStatus(prev => ({
        ...prev,
        isSyncing: false,
        lastSyncTime: new Date(),
        syncError: null,
      }));
      await updateUnsyncedCount();

      if (import.meta.env.DEV) {
        console.log('[Sync Status] Sync completed successfully');
      }
    } catch (error: any) {
      setSyncStatus(prev => ({
        ...prev,
        isSyncing: false,
        syncError: error.message || 'Sync failed',
      }));

      if (import.meta.env.DEV) {
        console.error('[Sync Status] Sync failed:', error);
      }
    }
  }, [isOnline, syncStatus.isSyncing, updateUnsyncedCount]);

  // Update unsynced count when coming online
  useEffect(() => {
    updateUnsyncedCount();
  }, [isOnline, updateUnsyncedCount]);

  // Poll for unsynced changes every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      updateUnsyncedCount();
    }, 30000);

    return () => clearInterval(interval);
  }, [updateUnsyncedCount]);

  return {
    ...syncStatus,
    triggerSync,
    updateUnsyncedCount,
  };
};
