/**
 * Background Sync API utilities
 * 
 * NOTE: Service Worker background sync is DISABLED because the SW cannot
 * access the user's JWT token, causing all sync operations to fail RLS policies.
 * All sync is now handled by the main-thread useAutoSync hook which has auth context.
 * 
 * This module is kept for:
 * - iOS localStorage fallback flags (polling-based sync triggers)
 * - onSyncComplete listener (for UI updates)
 * - clearPendingSyncs helper
 */

import { isIOS } from './mobile-detection';

// Type augmentation for Background Sync API (kept for reference)
interface SyncManager {
  register(tag: string): Promise<void>;
  getTags(): Promise<string[]>;
}

interface ServiceWorkerRegistration {
  readonly sync: SyncManager;
}

/**
 * Register background sync for inspection data
 * DISABLED: SW sync uses anon key without user JWT, failing RLS policies
 * Falls back to localStorage flag on iOS for polling-based sync
 */
export async function registerInspectionSync(): Promise<boolean> {
  // iOS fallback: use localStorage to track pending syncs (for polling triggers)
  if (isIOS()) {
    try {
      localStorage.setItem('pending-inspection-sync', Date.now().toString());
      if (import.meta.env.DEV) {
        console.log('[Background Sync] iOS: Marked inspections for sync');
      }
      return true;
    } catch (error) {
      console.error('[Background Sync] iOS: Failed to mark for sync:', error);
      return false;
    }
  }
  
  // SW sync is disabled - main thread useAutoSync handles sync with proper auth
  if (import.meta.env.DEV) {
    console.log('[Background Sync] SW sync disabled - using main thread sync');
  }
  return false;
}

/**
 * Register background sync for photos
 * DISABLED: SW sync uses anon key without user JWT, failing RLS policies
 */
export async function registerPhotoSync(): Promise<boolean> {
  // iOS fallback: use localStorage to track pending syncs
  if (isIOS()) {
    try {
      localStorage.setItem('pending-photo-sync', Date.now().toString());
      if (import.meta.env.DEV) {
        console.log('[Background Sync] iOS: Marked photos for sync');
      }
      return true;
    } catch (error) {
      console.error('[Background Sync] iOS: Failed to mark for sync:', error);
      return false;
    }
  }
  
  // SW sync is disabled
  if (import.meta.env.DEV) {
    console.log('[Background Sync] SW sync disabled - using main thread sync');
  }
  return false;
}

/**
 * Check if background sync is supported
 * Returns false since SW sync is disabled
 */
export function isBackgroundSyncSupported(): boolean {
  // SW sync is disabled due to auth issues
  return false;
}

/**
 * Check if there are pending syncs (iOS fallback)
 */
export function hasPendingSyncs(): boolean {
  if (!isIOS()) return false;
  
  const pendingInspections = localStorage.getItem('pending-inspection-sync');
  const pendingPhotos = localStorage.getItem('pending-photo-sync');
  
  return !!(pendingInspections || pendingPhotos);
}

/**
 * Clear pending sync flags (iOS fallback)
 */
export function clearPendingSyncs(): void {
  // Clear on both iOS and other platforms for safety
  try {
    localStorage.removeItem('pending-inspection-sync');
    localStorage.removeItem('pending-photo-sync');
    
    if (import.meta.env.DEV) {
      console.log('[Background Sync] Cleared pending sync flags');
    }
  } catch (error) {
    // localStorage might be unavailable in some contexts
    console.warn('[Background Sync] Failed to clear pending sync flags:', error);
  }
}

/**
 * Listen for sync completion messages from service worker
 * Kept for legacy compatibility but SW sync is disabled
 */
export function onSyncComplete(callback: (data: any) => void): () => void {
  if (!('serviceWorker' in navigator)) {
    return () => {};
  }
  
  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'SYNC_COMPLETED') {
      callback(event.data);
    }
  };
  
  navigator.serviceWorker.addEventListener('message', handler);
  
  // Return cleanup function
  return () => {
    navigator.serviceWorker.removeEventListener('message', handler);
  };
}

/**
 * Register periodic background sync
 * DISABLED: SW sync uses anon key without user JWT
 */
export async function registerPeriodicSync(): Promise<boolean> {
  // SW sync is disabled due to auth issues
  if (import.meta.env.DEV) {
    console.log('[Background Sync] Periodic sync disabled - using main thread polling');
  }
  return false;
}
