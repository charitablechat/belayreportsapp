import { useState, useEffect, useCallback } from 'react';
import { getUnsyncedInspections } from '@/lib/offline-storage';
import { syncAllInspectionsAtomic } from '@/lib/atomic-sync-manager';
import { useNetworkStatus } from './useNetworkStatus';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SyncStatus {
  unsyncedCount: number;
  unsyncedInspections: any[];
  isSyncing: boolean;
  lastSyncTime: Date | null;
  syncError: string | null;
}

export const useSyncStatus = () => {
  const { isOnline } = useNetworkStatus();
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
      toast.error("Cannot sync while offline");
      return;
    }
    
    if (syncStatus.isSyncing) {
      toast.info("Sync already in progress");
      return;
    }

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
      
      toast.error("Sync failed: " + error.message);

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
