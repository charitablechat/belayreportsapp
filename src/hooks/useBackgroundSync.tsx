import { useEffect, useCallback } from 'react';
import { onSyncComplete, isBackgroundSyncSupported, registerPeriodicSync } from '@/lib/background-sync';
import { useSyncStatus } from './useSyncStatus';

/**
 * Hook for managing background sync functionality
 * Listens for sync completion messages from the service worker
 * and updates the UI accordingly
 */
export const useBackgroundSync = () => {
  const { updateUnsyncedCount } = useSyncStatus();
  const isSupported = isBackgroundSyncSupported();
  
  const handleSyncComplete = useCallback((data: any) => {
    if (data.success) {
      // Silent sync - no user notifications
      if (import.meta.env.DEV) {
        console.log('[Background Sync] Complete:', data.tag, 'count:', data.count);
      }
      // Update sync status to reflect changes
      updateUnsyncedCount();
    }
  }, [updateUnsyncedCount]);
  
  useEffect(() => {
    if (!isSupported) {
      if (import.meta.env.DEV) {
        console.log('[useBackgroundSync] Background Sync not supported');
      }
      return;
    }
    
    // Listen for sync completion messages
    onSyncComplete(handleSyncComplete);
    
    // Register periodic sync for multi-device scenarios
    registerPeriodicSync();
    
    if (import.meta.env.DEV) {
      console.log('[useBackgroundSync] Background Sync initialized');
    }
  }, [isSupported, handleSyncComplete]);
  
  return { 
    isSupported,
    supportsBackgroundSync: isSupported
  };
};
