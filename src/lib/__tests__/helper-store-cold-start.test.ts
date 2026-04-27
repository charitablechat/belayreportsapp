/**
 * Regression: regression-skip-store and empty-local-conflict-store must NOT
 * auto-create an empty v1 of the main `rope-works-inspections` DB on cold
 * start, the same way `probeIndexedDB` was fixed in PR #15.
 *
 * Both helper stores share the main DB. The previous implementation called
 * `openDB('rope-works-inspections')` (no version) on first access — which
 * silently auto-creates a v1 database when the main DB has not been opened
 * yet. The subsequent main `getDB()` open at v18 then has to perform a
 * v1→v18 upgrade and races the still-open helper-store connection,
 * emitting `[Offline Storage] DB upgrade blocked` warnings followed by 5s
 * open timeouts in field reports.
 *
 * Fix: probe the existing version with `detectExistingDBVersion` first and
 * degrade to a no-op (return null) when the DB has not been opened yet.
 *
 * These tests assert:
 *   1. Calling either helper-store getter before the main DB exists does
 *      NOT leave an empty v1 behind for the next caller.
 *   2. Reads/writes degrade to a no-op (return 0/null) instead of throwing.
 *   3. Once the main DB has been opened at v18, the helper-store getters
 *      adopt the existing version and find their stores.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from 'idb';

const MAIN_DB_NAME = 'rope-works-inspections';

async function deleteDB(name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

async function listDBs(): Promise<{ name?: string; version?: number }[]> {
  if (typeof indexedDB.databases === 'function') {
    return await indexedDB.databases();
  }
  return [];
}

/**
 * Each test uses fresh module instances so the in-module
 * `dbHandlePromise` cache from a prior test doesn't leak across cases.
 */
async function freshHelpers() {
  // vitest's resetModules clears the module cache so the in-module
  // `dbHandlePromise` (closure over `let dbHandlePromise = null`) is
  // re-initialised for this test.
  const { vi } = await import('vitest');
  vi.resetModules();
  const regression = await import('../regression-skip-store');
  const conflict = await import('../empty-local-conflict-store');
  return { regression, conflict };
}

describe('helper-store cold-start guards (regression-skip-store, empty-local-conflict-store)', () => {
  beforeEach(async () => {
    await deleteDB(MAIN_DB_NAME);
  });

  it('regression-skip-store does not auto-create rope-works-inspections at v1 on cold start', async () => {
    const { regression } = await freshHelpers();
    // Pre-condition: main DB does not exist.
    const before = await listDBs();
    expect(before.find((d) => d.name === MAIN_DB_NAME)).toBeUndefined();

    // First access should degrade to 0 (the cache returns 0 for missing
    // entries) WITHOUT creating an empty v1 of the main DB.
    const count = await regression.getRegressionSkipCount('inspection-cold-start-1');
    expect(count).toBe(0);

    const after = await listDBs();
    const created = after.find((d) => d.name === MAIN_DB_NAME);
    expect(created).toBeUndefined();
  });

  it('empty-local-conflict-store does not auto-create rope-works-inspections at v1 on cold start', async () => {
    const { conflict } = await freshHelpers();
    const before = await listDBs();
    expect(before.find((d) => d.name === MAIN_DB_NAME)).toBeUndefined();

    const entry = await conflict.getEmptyLocalConflict('inspection-cold-start-2');
    expect(entry).toBeNull();

    const after = await listDBs();
    expect(after.find((d) => d.name === MAIN_DB_NAME)).toBeUndefined();
  });

  it('regression-skip-store increment degrades to a hot-cache-only write on cold start (does NOT create v1)', async () => {
    const { regression } = await freshHelpers();
    // Pre-condition: main DB does not exist.
    const before = await listDBs();
    expect(before.find((d) => d.name === MAIN_DB_NAME)).toBeUndefined();

    // increment writes through to IDB if available, but should still
    // avoid creating an accidental v1 when it isn't.
    const next = await regression.incrementRegressionSkipCount('inspection-cold-start-3');
    expect(next).toBe(1);

    const after = await listDBs();
    expect(after.find((d) => d.name === MAIN_DB_NAME)).toBeUndefined();

    // A subsequent read in the same process picks up the hot-cache value
    // even though IDB never persisted it (DB wasn't created).
    const readBack = await regression.getRegressionSkipCount('inspection-cold-start-3');
    expect(readBack).toBe(1);
  });

  it('regression-skip-store adopts the existing version once the main DB is opened at v18', async () => {
    // Simulate the main getDB() having run already: open at v18 with the
    // store the helper expects.
    const db = await openDB(MAIN_DB_NAME, 18, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sync_regression_counters')) {
          db.createObjectStore('sync_regression_counters', { keyPath: 'id' });
        }
      },
    });
    db.close();

    const { regression } = await freshHelpers();

    // Helper now finds the store and writes through.
    const next = await regression.incrementRegressionSkipCount('inspection-warm-1');
    expect(next).toBe(1);

    // Re-open in a separate handle and confirm the row landed.
    const db2 = await openDB(MAIN_DB_NAME, 18);
    const row = await db2.get('sync_regression_counters', 'inspection-warm-1');
    expect(row).toBeDefined();
    expect((row as { count: number }).count).toBe(1);
    db2.close();
  });
});
