/**
 * C2: Persistent backing store for empty-local-guard conflicts.
 *
 * The atomic-sync-manager's empty-local-guard fires when a previously-synced
 * report has child data on the server but ALL child sections are empty in
 * IndexedDB and `user_cleared_at` is not stamped. Previously this auto-restored
 * server child rows into IDB silently — which clobbered intentional user
 * deletions in races (debounced autosave still in flight, cross-tab edits, etc.)
 *
 * Now the guard records a conflict here and skips. The user resolves it from
 * SyncDiagnosticsSheet by choosing Restore from server / Confirm local empty /
 * Dismiss.
 *
 * Mirrors regression-skip-store.ts shape (IDB-backed, hot cache, 30-day TTL,
 * tolerant if the store doesn't yet exist).
 */

import { openDB, type IDBPDatabase } from 'idb';
import { detectExistingDBVersion } from './offline-storage';

const DB_NAME = 'rope-works-inspections';
const STORE_NAME = 'sync_empty_local_conflicts';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type EmptyLocalReportType = 'inspection' | 'training' | 'daily_assessment' | 'jcf';

export interface EmptyLocalConflictEntry {
  /** Parent record id (inspection/training/assessment). Primary key. */
  id: string;
  reportType: EmptyLocalReportType;
  detectedAt: number;
  /** Section name → row count on the server at detection time. */
  serverCounts: Record<string, number>;
  /** Best-effort label for the UI (organization name, location, etc.). */
  organizationLabel?: string;
}

// Hot cache for fast reads from the diagnostics sheet.
const cache = new Map<string, EmptyLocalConflictEntry>();

let dbHandlePromise: Promise<IDBPDatabase | null> | null = null;

async function getDB(): Promise<IDBPDatabase | null> {
  if (!dbHandlePromise) {
    dbHandlePromise = (async () => {
      try {
        // Probe the existing version FIRST instead of calling
        // `openDB(DB_NAME)` (no version). The bare-`openDB` form
        // silently auto-creates an empty v1 database when the DB does
        // not yet exist, which then races the main `getDB()` open at
        // v18 in offline-storage.ts and emits the
        // `[Offline Storage] DB upgrade blocked` warning seen in
        // field reports. This is the same antipattern PR #15 fixed in
        // `probeIndexedDB`. The store is created in the v13 upgrade
        // handler, so we degrade to a no-op when (a) the main DB has
        // never been opened (existingVersion <= 0) or (b) the store
        // was not added yet for the negotiated version. The first
        // user-driven save will trigger offline-storage's getDB(),
        // which performs the real fresh-install upgrade chain.
        const existingVersion = await detectExistingDBVersion(DB_NAME);
        if (existingVersion <= 0) {
          return null;
        }
        const db = await openDB(DB_NAME, existingVersion);
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.close();
          return null;
        }
        return db;
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[empty-local-conflict-store] DB open failed:', err);
        }
        return null;
      }
    })();
  }
  return dbHandlePromise;
}

function isExpired(entry: EmptyLocalConflictEntry): boolean {
  return Date.now() - entry.detectedAt > TTL_MS;
}

/**
 * Record a new conflict (or refresh an existing one with newer counts).
 * Best-effort — failures are swallowed so sync hot path is never blocked.
 */
export async function recordEmptyLocalConflict(
  entry: EmptyLocalConflictEntry,
): Promise<void> {
  cache.set(entry.id, entry);
  const db = await getDB();
  if (!db) return;
  try {
    await db.put(STORE_NAME, entry);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[empty-local-conflict-store] write failed for', entry.id, err);
    }
  }
}

/**
 * Read a single conflict entry. Returns null when missing/expired.
 */
export async function getEmptyLocalConflict(
  id: string,
): Promise<EmptyLocalConflictEntry | null> {
  if (cache.has(id)) {
    const hot = cache.get(id)!;
    if (!isExpired(hot)) return hot;
    cache.delete(id);
  }
  const db = await getDB();
  if (!db) return null;
  try {
    const row = (await db.get(STORE_NAME, id)) as EmptyLocalConflictEntry | undefined;
    if (!row) return null;
    if (isExpired(row)) {
      db.delete(STORE_NAME, id).catch(() => {});
      return null;
    }
    cache.set(id, row);
    return row;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[empty-local-conflict-store] read failed for', id, err);
    }
    return null;
  }
}

/**
 * List all active (non-expired) conflicts for the diagnostics UI.
 */
export async function listEmptyLocalConflicts(): Promise<EmptyLocalConflictEntry[]> {
  const db = await getDB();
  if (!db) {
    return Array.from(cache.values()).filter((e) => !isExpired(e));
  }
  try {
    const rows = (await db.getAll(STORE_NAME)) as EmptyLocalConflictEntry[];
    const fresh = rows.filter((r) => !isExpired(r));
    fresh.forEach((r) => cache.set(r.id, r));
    return fresh.sort((a, b) => b.detectedAt - a.detectedAt);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[empty-local-conflict-store] list failed:', err);
    }
    return [];
  }
}

/**
 * Clear a conflict — called after the user resolves it (restore / confirm /
 * dismiss) or when sync naturally repairs the condition.
 */
export async function clearEmptyLocalConflict(id: string): Promise<void> {
  cache.delete(id);
  notifiedIds.delete(id);
  const db = await getDB();
  if (!db) return;
  try {
    await db.delete(STORE_NAME, id);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[empty-local-conflict-store] delete failed for', id, err);
    }
  }
}

// ─── In-process notification de-dupe ──────────────────────────────────────
// The sync path can hit the empty-local-guard on every cycle. We only want
// the toast/notification to fire once per detection chain so we don't spam.
const notifiedIds = new Set<string>();

/**
 * Returns true the FIRST time it's called for a given id (in this process).
 * Caller uses this to gate the user-visible notification. Cleared inside
 * `clearEmptyLocalConflict` so a re-detection after resolution fires again.
 */
export function shouldNotifyForEmptyLocalConflict(id: string): boolean {
  if (notifiedIds.has(id)) return false;
  notifiedIds.add(id);
  return true;
}
