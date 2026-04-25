/**
 * Regression: detectExistingDBVersion must NOT auto-create an empty v1 DB
 * as a side effect when the requested DB does not yet exist.
 *
 * The previous implementation called `openDB(name)` (no version), which
 * silently auto-creates v1 on cold-start profiles. The subsequent
 * `openDB(name, 18)` upgrade then races against the dangling v1 connection,
 * surfacing as `[Offline Storage] DB upgrade blocked` warnings followed by
 * 5s open timeouts.
 *
 * These tests exercise the path against fake-indexeddb so we can assert:
 *   1. A fresh probe of a non-existent DB returns 0 and does NOT leave an
 *      empty v1 behind for the next caller.
 *   2. A probe of an existing DB at v18 returns 18 without triggering an
 *      upgrade or interfering with the open connection lifecycle.
 *   3. A probe of an existing DB at v3 returns 3 (so the migration-safety
 *      pre-upgrade snapshot path still has the version it needs).
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from 'idb';
import { detectExistingDBVersion } from '../offline-storage';

const TEST_DB_NAME = 'detect-existing-db-version-test';

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

describe('detectExistingDBVersion', () => {
  beforeEach(async () => {
    await deleteDB(TEST_DB_NAME);
  });

  it('returns 0 for a non-existent DB and leaves no empty v1 behind', async () => {
    const v = await detectExistingDBVersion(TEST_DB_NAME);
    expect(v).toBe(0);

    const dbs = await listDBs();
    const accidental = dbs.find((d) => d.name === TEST_DB_NAME);
    // Either the DB was never created, or the cleanup deleted it.
    expect(accidental).toBeUndefined();
  });

  it('returns the existing version for a v18 DB and does not trigger an upgrade', async () => {
    let upgradeFired = false;
    const db = await openDB(TEST_DB_NAME, 18, {
      upgrade(db) {
        db.createObjectStore('inspections', { keyPath: 'id' });
      },
    });
    db.close();

    const v = await detectExistingDBVersion(TEST_DB_NAME);
    expect(v).toBe(18);

    // Re-open and confirm upgrade did NOT re-fire from a stale probe-side
    // version mismatch.
    const db2 = await openDB(TEST_DB_NAME, 18, {
      upgrade() { upgradeFired = true; },
    });
    expect(upgradeFired).toBe(false);
    expect(db2.objectStoreNames.contains('inspections')).toBe(true);
    db2.close();
  });

  it('returns intermediate version 3 so migration-safety snapshots still run', async () => {
    const db = await openDB(TEST_DB_NAME, 3, {
      upgrade(db) {
        db.createObjectStore('inspections', { keyPath: 'id' });
      },
    });
    db.close();

    const v = await detectExistingDBVersion(TEST_DB_NAME);
    expect(v).toBe(3);
  });

  it('returns 0 cleanly when indexedDB.databases() throws', async () => {
    // Simulate Firefox <126 / Safari without databases() by stubbing the
    // method with one that rejects, forcing the native-fallback path.
    const original = indexedDB.databases;
    Object.defineProperty(indexedDB, 'databases', {
      configurable: true,
      value: async () => { throw new Error('not supported'); },
    });
    try {
      const v = await detectExistingDBVersion(TEST_DB_NAME);
      expect(v).toBe(0);
      const dbs = (typeof original === 'function')
        ? await original.call(indexedDB)
        : [];
      expect(dbs.find((d) => d.name === TEST_DB_NAME)).toBeUndefined();
    } finally {
      Object.defineProperty(indexedDB, 'databases', {
        configurable: true,
        value: original,
      });
    }
  });
});
