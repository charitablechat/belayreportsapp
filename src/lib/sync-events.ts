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

// ─── C9: Remote-deleted conflict bus ───────────────────────────────────────
// Emitted by atomic-sync-manager when the server reports a record as
// soft-deleted while the local copy still has unsynced edits. The local
// row is quarantined (not wiped); the UI subscribes here to surface a
// dialog so the user can Restore-as-New or Discard.

export interface RemoteDeletedConflictPayload {
  table: 'inspections' | 'trainings' | 'daily_assessments';
  recordId: string;
  remoteDeletedAt: string;
  organizationLabel?: string | null;
}

type RemoteDeletedListener = (p: RemoteDeletedConflictPayload) => void;
const remoteDeletedListeners = new Set<RemoteDeletedListener>();

export function onRemoteDeletedConflict(listener: RemoteDeletedListener): () => void {
  remoteDeletedListeners.add(listener);
  return () => remoteDeletedListeners.delete(listener);
}

export function emitRemoteDeletedConflict(payload: RemoteDeletedConflictPayload): void {
  remoteDeletedListeners.forEach((l) => {
    try { l(payload); } catch (err) {
      console.error('[SyncEvents] Remote-deleted listener error:', err);
    }
  });
  // Also dispatch a window event so non-React listeners (diagnostics,
  // notification-center) can react without importing this module.
  try {
    window.dispatchEvent(new CustomEvent('sync-remote-deleted-conflict', { detail: payload }));
  } catch {}
}

// ─── H3: Active-form record registry ──────────────────────────────────────
// Forms register the (table, id) they are currently mounted-and-editing.
// The global Realtime IDB writer in useAutoSync skips overwriting a record
// that is in this set, since the form holds unsaved React state that hasn't
// been flushed to IDB and an IDB swap would be silently clobbered by the
// next debounced autosave (causing downstream parent/child timestamp
// mismatches and ultimately data loss).

export type ActiveFormTable = 'inspections' | 'trainings' | 'daily_assessments';

const activeFormRecords = new Map<string, ActiveFormTable>(); // id -> table

export function registerActiveFormRecord(table: ActiveFormTable, id: string): void {
  if (!id) return;
  activeFormRecords.set(id, table);
}

export function unregisterActiveFormRecord(id: string): void {
  if (!id) return;
  activeFormRecords.delete(id);
}

export function isActiveFormRecord(table: ActiveFormTable, id: string): boolean {
  if (!id) return false;
  return activeFormRecords.get(id) === table;
}

// ─── H3: Pending remote update bus ────────────────────────────────────────
// Emitted when the global Realtime writer SKIPS an IDB overwrite because the
// target record is currently mounted in a form. The form subscribes to this
// to surface a "Remote update available — reload?" banner.

export interface PendingRemoteUpdate {
  table: ActiveFormTable;
  recordId: string;
  remoteUpdatedAt: string;
}

type PendingRemoteUpdateListener = (p: PendingRemoteUpdate) => void;
const pendingRemoteUpdateListeners = new Set<PendingRemoteUpdateListener>();

export function onPendingRemoteUpdate(listener: PendingRemoteUpdateListener): () => void {
  pendingRemoteUpdateListeners.add(listener);
  return () => pendingRemoteUpdateListeners.delete(listener);
}

export function emitPendingRemoteUpdate(payload: PendingRemoteUpdate): void {
  pendingRemoteUpdateListeners.forEach((l) => {
    try { l(payload); } catch (err) {
      console.error('[SyncEvents] Pending-remote-update listener error:', err);
    }
  });
}
