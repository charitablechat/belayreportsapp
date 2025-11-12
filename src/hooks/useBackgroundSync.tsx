import { useEffect, useCallback } from 'react';
import { onSyncComplete, isBackgroundSyncSupported, registerPeriodicSync } from '@/lib/background-sync';
import { toast } from 'sonner';
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
      if (data.tag === 'inspection-sync') {
        toast.success(
          data.count > 0 
            ? `${data.count} inspection(s) synced in background` 
            : 'Inspections synced'
        );
      } else if (data.tag === 'photo-sync') {
        toast.success(
          data.count > 0 
            ? `${data.count} photo(s) uploaded in background` 
            : 'Photos synced'
        );
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
