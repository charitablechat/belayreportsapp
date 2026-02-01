/**
 * Sync Events - Simple event emitter for sync completion
 * Allows Dashboard and other components to react to successful syncs
 * 
 * This bridges the gap between useAutoSync (which handles background sync)
 * and Dashboard (which uses manual useState for data management)
 */

type SyncEventListener = () => void;
const listeners = new Set<SyncEventListener>();

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
