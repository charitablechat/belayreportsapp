/**
 * Persistent backing store for the field-count regression skip counter.
 *
 * Background: atomic-sync-manager.ts blocks sync when local field count drops
 * by more than 50% vs. the last persisted version. After MAX_REGRESSION_SKIPS
 * consecutive blocks the guard releases so a legitimate large deletion isn't
 * stuck forever. Previously the counter lived in a module-level Map that was
 * wiped on tab refresh / PWA wake, so a user who reloaded between cycles
 * could ping-pong on the guard indefinitely.
 *
 * This store persists the counter in IndexedDB (`sync_regression_counters`
 * store) with an in-memory hot cache for fast reads. A 30-day TTL prunes
 * dead record ids.
 */

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'rope-works-inspections';
const STORE_NAME = 'sync_regression_counters';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CounterRow {
  id: string;
  count: number;
  lastIncrementAt: number;
}

// In-memory hot cache so the existing call sites don't pay the IDB cost on
// every guard hit. Writes go through to IDB AND update the cache.
const cache = new Map<string, number>();

let dbHandlePromise: Promise<IDBPDatabase | null> | null = null;

async function getDB(): Promise<IDBPDatabase | null> {
  if (!dbHandlePromise) {
    dbHandlePromise = (async () => {
      try {
        // Open without specifying a version — adopt whatever version
        // offline-storage.ts has already negotiated. The store is created
        // there in the v11 upgrade handler.
        const db = await openDB(DB_NAME);
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.close();
          return null;
        }
        return db;
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[regression-skip-store] DB open failed:', err);
        }
        return null;
      }
    })();
  }
  return dbHandlePromise;
}

function isExpired(row: CounterRow): boolean {
  return Date.now() - row.lastIncrementAt > TTL_MS;
}

/**
 * Read the current skip count for a record. Returns 0 for missing/expired.
 * Hot-cache aware — only hits IDB on first access per process.
 */
export async function getRegressionSkipCount(id: string): Promise<number> {
  if (cache.has(id)) return cache.get(id)!;
  const db = await getDB();
  if (!db) return 0;
  try {
    const row = (await db.get(STORE_NAME, id)) as CounterRow | undefined;
    if (!row) {
      cache.set(id, 0);
      return 0;
    }
    if (isExpired(row)) {
      // Stale — drop and report 0. Best-effort delete.
      db.delete(STORE_NAME, id).catch(() => {});
      cache.set(id, 0);
      return 0;
    }
    cache.set(id, row.count);
    return row.count;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[regression-skip-store] read failed for', id, err);
    }
    return cache.get(id) ?? 0;
  }
}

/**
 * Bump the counter by one. Returns the new value. Persists to IDB.
 */
export async function incrementRegressionSkipCount(id: string): Promise<number> {
  const current = await getRegressionSkipCount(id);
  const next = current + 1;
  cache.set(id, next);
  const db = await getDB();
  if (db) {
    try {
      await db.put(STORE_NAME, {
        id,
        count: next,
        lastIncrementAt: Date.now(),
      } satisfies CounterRow);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[regression-skip-store] write failed for', id, err);
      }
    }
  }
  return next;
}

/**
 * Reset (delete) the counter for a record. Called when sync succeeds or the
 * field count returns to a healthy range.
 */
export async function resetRegressionSkipCount(id: string): Promise<void> {
  cache.delete(id);
  const db = await getDB();
  if (!db) return;
  try {
    await db.delete(STORE_NAME, id);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[regression-skip-store] delete failed for', id, err);
    }
  }
}
