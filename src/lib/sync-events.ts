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

/**
 * S6: Per-record self-write suppression registry.
 * The atomic-sync helpers register the record id right before/after their
 * server writes. The Realtime handler in useAutoSync consults this to skip
 * triggering a redundant sync for events emitted by our own writes.
 *
 * 15s TTL covers the transaction commit + align_synced_at follow-up window.
 */
const recentSelfWriteIds = new Map<string, number>();
const DEFAULT_SELF_WRITE_TTL = 15000;

export function registerSelfWrite(id: string, ttlMs: number = DEFAULT_SELF_WRITE_TTL): void {
  if (!id) return;
  recentSelfWriteIds.set(id, Date.now() + ttlMs);
}

export function isRecentSelfWrite(id: string): boolean {
  if (!id) return false;
  const exp = recentSelfWriteIds.get(id);
  if (!exp) return false;
  if (exp < Date.now()) {
    recentSelfWriteIds.delete(id);
    return false;
  }
  return true;
}

const STALE_TIMESTAMP_KEY = 'dashboardStaleTimestamp';

/**
 * Mark the dashboard data as stale by writing a timestamp to sessionStorage.
 * Called by report form pages before navigating back to Dashboard.
 * Dashboard reads this on mount to force a fresh network fetch.
 * 
 * Replaces the old dispatchDashboardRefresh() which fired a DOM event
 * that was always lost because Dashboard hadn't mounted yet during SPA navigation.
 */
export function markDashboardStaleTimestamp(): void {
  try {
    sessionStorage.setItem(STALE_TIMESTAMP_KEY, String(Date.now()));
  } catch {}
}

/**
 * Check if Dashboard data was marked stale by a report form.
 * Consumes the flag so it only triggers once.
 * Returns true if a stale marker was found (meaning a report form navigated away recently).
 */
export function consumeDashboardStaleTimestamp(): boolean {
  try {
    const ts = sessionStorage.getItem(STALE_TIMESTAMP_KEY);
    if (ts) {
      sessionStorage.removeItem(STALE_TIMESTAMP_KEY);
      // Only consider stale if marked within the last 60 seconds
      return (Date.now() - parseInt(ts, 10)) < 60000;
    }
  } catch {}
  return false;
}

const PENDING_REFRESH_KEY = 'pendingDashboardRefresh';

export function markPendingDashboardRefresh(): void {
  sessionStorage.setItem(PENDING_REFRESH_KEY, '1');
}

export function consumePendingDashboardRefresh(): boolean {
  const pending = sessionStorage.getItem(PENDING_REFRESH_KEY);
  if (pending) {
    sessionStorage.removeItem(PENDING_REFRESH_KEY);
    return true;
  }
  return false;
}
