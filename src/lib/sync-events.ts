/**
 * Sync Events - Simple event emitter for sync completion
 * Allows Dashboard and other components to react to successful syncs
 * 
 * This bridges the gap between useAutoSync (which handles background sync)
 * and Dashboard (which uses manual useState for data management)
 */

type SyncEventListener = () => void;
const listeners = new Set<SyncEventListener>();

// Global sync-in-progress flag
// Prevents Dashboard orphan cleanup from running while sync is active
let _syncInProgress = false;

/**
 * Check if a sync operation is currently in progress
 */
export function isSyncInProgress(): boolean {
  return _syncInProgress;
}

/**
 * Set the sync-in-progress flag (called by useAutoSync)
 */
export function setSyncInProgress(value: boolean): void {
  _syncInProgress = value;
}

/**
 * Subscribe to sync completion events
 * @param listener Callback to invoke when sync completes
 * @returns Unsubscribe function
 */
export function onSyncComplete(listener: SyncEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Emit sync completion event to all subscribers
 * Called by useAutoSync after successful background sync
 */
export function emitSyncComplete(): void {
  listeners.forEach(listener => {
    try {
      listener();
    } catch (error) {
      console.error('[SyncEvents] Listener error:', error);
    }
  });
}
