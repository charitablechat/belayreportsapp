/**
 * Background Sync API utilities
 * Enables automatic data synchronization even when the app is closed
 */

// Type augmentation for Background Sync API
interface SyncManager {
  register(tag: string): Promise<void>;
  getTags(): Promise<string[]>;
}

interface ServiceWorkerRegistration {
  readonly sync: SyncManager;
}

/**
 * Register background sync for inspection data
 */
export async function registerInspectionSync(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) {
    if (import.meta.env.DEV) {
      console.warn('[Background Sync] Not supported in this browser');
    }
    return false;
  }
  
  try {
    const registration = await navigator.serviceWorker.ready;
    await (registration as any).sync.register('inspection-sync');
    
    if (import.meta.env.DEV) {
      console.log('[Background Sync] Registered: inspection-sync');
    }
    
    return true;
  } catch (error) {
    console.error('[Background Sync] Registration failed:', error);
    return false;
  }
}

/**
 * Register background sync for photos
 */
export async function registerPhotoSync(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) {
    if (import.meta.env.DEV) {
      console.warn('[Background Sync] Not supported in this browser');
    }
    return false;
  }
  
  try {
    const registration = await navigator.serviceWorker.ready;
    await (registration as any).sync.register('photo-sync');
    
    if (import.meta.env.DEV) {
      console.log('[Background Sync] Registered: photo-sync');
    }
    
    return true;
  } catch (error) {
    console.error('[Background Sync] Registration failed:', error);
    return false;
  }
}

/**
 * Check if background sync is supported
 */
export function isBackgroundSyncSupported(): boolean {
  return 'serviceWorker' in navigator && 'SyncManager' in window;
}

/**
 * Listen for sync completion messages from service worker
 */
export function onSyncComplete(callback: (data: any) => void): void {
  if (!('serviceWorker' in navigator)) return;
  
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data.type === 'SYNC_COMPLETED') {
      callback(event.data);
    }
  });
}

/**
 * Register periodic background sync (for multi-device scenarios)
 * Note: Only supported in Chrome/Edge
 */
export async function registerPeriodicSync(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    return false;
  }
  
  try {
    const registration = await navigator.serviceWorker.ready;
    
    if (!('periodicSync' in registration)) {
      if (import.meta.env.DEV) {
        console.log('[Background Sync] Periodic Background Sync not supported');
      }
      return false;
    }
    
    // @ts-ignore - periodicSync is not in TypeScript types yet
    await registration.periodicSync.register('periodic-inspection-sync', {
      minInterval: 12 * 60 * 60 * 1000, // 12 hours in milliseconds
    });
    
    if (import.meta.env.DEV) {
      console.log('[Background Sync] Periodic Background Sync registered');
    }
    
    return true;
  } catch (error) {
    console.error('[Background Sync] Periodic sync registration failed:', error);
    return false;
  }
}
