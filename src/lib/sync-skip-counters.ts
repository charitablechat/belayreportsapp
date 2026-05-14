/**
 * Lightweight in-memory + localStorage telemetry for sync short-circuits
 * that today only surface as console warnings.
 *
 * P1 from the photo-sync audit: when `assertRealSessionForSync('photos')`
 * returns false (placeholder/guest/expired JWT), the photo pipeline aborts
 * silently. Surface the skip count so the user (or Belay) can spot a
 * device that is "online but never syncs".
 *
 * Persists to localStorage (`sync_skip_counters_v1`) so a refresh/PWA
 * restart does not zero the counters.
 */

const STORAGE_KEY = 'sync_skip_counters_v1';

export type SyncSkipReason =
  | 'no-real-session'        // assertRealSessionForSync returned false
  | 'offline'                // navigator.onLine === false
  | 'parent-temp-id';        // photo's parent inspection still on temp-* id

export interface SyncSkipCountersSnapshot {
  noRealSession: number;
  offline: number;
  parentTempId: number;
  lastSkipAt: number | null;
  lastReason: SyncSkipReason | null;
}

const DEFAULT: SyncSkipCountersSnapshot = {
  noRealSession: 0,
  offline: 0,
  parentTempId: 0,
  lastSkipAt: null,
  lastReason: null,
};

function read(): SyncSkipCountersSnapshot {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<SyncSkipCountersSnapshot>;
    return {
      noRealSession: typeof parsed.noRealSession === 'number' ? parsed.noRealSession : 0,
      offline: typeof parsed.offline === 'number' ? parsed.offline : 0,
      parentTempId: typeof parsed.parentTempId === 'number' ? parsed.parentTempId : 0,
      lastSkipAt: typeof parsed.lastSkipAt === 'number' ? parsed.lastSkipAt : null,
      lastReason: (parsed.lastReason as SyncSkipReason | null) ?? null,
    };
  } catch {
    return { ...DEFAULT };
  }
}

function write(snap: SyncSkipCountersSnapshot): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    }
  } catch {
    /* quota / private mode — silently drop */
  }
}

export function recordSyncSkip(reason: SyncSkipReason, count = 1): void {
  const snap = read();
  if (reason === 'no-real-session') snap.noRealSession += count;
  else if (reason === 'offline') snap.offline += count;
  else if (reason === 'parent-temp-id') snap.parentTempId += count;
  snap.lastSkipAt = Date.now();
  snap.lastReason = reason;
  write(snap);
}

export function getSyncSkipCounters(): SyncSkipCountersSnapshot {
  return read();
}

export function resetSyncSkipCounters(): void {
  write({ ...DEFAULT });
}
