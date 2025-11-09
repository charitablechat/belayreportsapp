import { useState, useEffect, useCallback } from 'react';
import { getUnsyncedInspections } from '@/lib/offline-storage';
import { syncInspections } from '@/lib/sync-manager';
import { useNetworkStatus } from './useNetworkStatus';

export interface SyncStatus {
  unsyncedCount: number;
  isSyncing: boolean;
  lastSyncTime: Date | null;
  syncError: string | null;
}

export const useSyncStatus = () => {
  const { isOnline } = useNetworkStatus();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    unsyncedCount: 0,
    isSyncing: false,
    lastSyncTime: null,
    syncError: null,
  });

  const updateUnsyncedCount = useCallback(async () => {
    try {
      const unsynced = await getUnsyncedInspections();
      setSyncStatus(prev => ({
        ...prev,
        unsyncedCount: unsynced.length,
      }));

      if (import.meta.env.DEV) {
        console.log('[Sync Status] Unsynced count updated:', unsynced.length);
      }
    } catch (error) {
      console.error('[Sync Status] Error getting unsynced count:', error);
    }
  }, []);

  const triggerSync = useCallback(async () => {
    if (!isOnline || syncStatus.isSyncing) {
      if (import.meta.env.DEV) {
        console.log('[Sync Status] Sync skipped:', { isOnline, isSyncing: syncStatus.isSyncing });
      }
      return;
    }

    setSyncStatus(prev => ({ ...prev, isSyncing: true, syncError: null }));

    if (import.meta.env.DEV) {
      console.log('[Sync Status] Sync triggered manually');
    }

    try {
      await syncInspections();
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
