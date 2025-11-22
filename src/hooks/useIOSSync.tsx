import { useEffect, useCallback } from 'react';
import { syncAllInspectionsAtomic } from '@/lib/atomic-sync-manager';
import { syncPhotos } from '@/lib/sync-manager';
import { isIOS } from '@/lib/mobile-detection';
import { toast } from 'sonner';

/**
 * Custom hook for iOS-specific sync behavior
 * iOS Safari has strict PWA limitations, so we use polling and visibility-based sync
 */
export const useIOSSync = () => {
  const isIOSDevice = isIOS();
  
  const performSync = useCallback(async (silent = true) => {
    if (!navigator.onLine) return;
    
    try {
      if (import.meta.env.DEV) {
        console.log('[iOS Sync] Starting sync...');
      }
      
      await Promise.all([
        syncAllInspectionsAtomic(),
        syncPhotos()
      ]);
      
      if (!silent && import.meta.env.DEV) {
        console.log('[iOS Sync] Completed successfully');
      }
    } catch (error) {
      console.error('[iOS Sync] Failed:', error);
      if (!silent) {
        toast.error('Sync failed. Will retry automatically.');
      }
    }
  }, []);

  useEffect(() => {
    if (!isIOSDevice) return;

    if (import.meta.env.DEV) {
      console.log('[iOS Sync] Initialized iOS-specific sync behavior');
    }

    // Sync immediately on mount
    performSync(true);

    // Poll every 30 seconds when app is visible (iOS doesn't support background sync)
    const pollInterval = setInterval(() => {
      if (!document.hidden && navigator.onLine) {
        performSync(true);
      }
    }, 30000);

    // Sync on visibility change
    const handleVisibilityChange = () => {
      if (!document.hidden && navigator.onLine) {
        if (import.meta.env.DEV) {
          console.log('[iOS Sync] App became visible, syncing...');
        }
        performSync(true);
      }
    };

    // Sync on page show (iOS specific - handles back/forward navigation)
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && navigator.onLine) {
        if (import.meta.env.DEV) {
          console.log('[iOS Sync] Page restored from bfcache, syncing...');
        }
        performSync(true);
      }
    };

    // Sync on focus (iOS Safari)
    const handleFocus = () => {
      if (navigator.onLine) {
        if (import.meta.env.DEV) {
          console.log('[iOS Sync] App gained focus, syncing...');
        }
        performSync(true);
      }
    };

    // Sync when coming online
    const handleOnline = () => {
      if (import.meta.env.DEV) {
        console.log('[iOS Sync] Device came online, syncing...');
      }
      performSync(false); // Not silent - show user feedback
      toast.success('Back online - syncing data...');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);

    return () => {
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, [isIOSDevice, performSync]);

  return {
    isIOSDevice,
    performSync,
  };
};
