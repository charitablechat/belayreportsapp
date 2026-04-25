/**
 * Regression: getDB() must assign `dbPromise` synchronously so that parallel
 * callers in the same tick share one in-flight openDB chain.
 *
 * The previous implementation did:
 *   if (!dbPromise) {
 *     await ensureStorage();                  // <-- yield #1
 *     ...
 *     await detectExistingDBVersion(DB_NAME); // <-- yield #2
 *     ...
 *     dbPromise = Promise.race([ openDBV8WithTimeout(), <timeout> ]);
 *   }
 *
 * Between the truthy-check and the assignment there were ≥3 `await` yields,
 * so every caller in `Promise.all([...])` saw `dbPromise === null`, each
 * entered the if-branch, each opened a fresh connection at v18, and each
 * fired its own 5s timeout — observed as 4-6 consecutive
 * `[Offline Storage] IndexedDB open timed out after 5s` warnings during
 * the scope-C offline-edit reproduction (blocker #3) when InspectionForm
 * fanned out 6 parallel saves (`saveInspectionOffline` +
 * 5×`saveRelatedDataOffline`).
 *
 * The fix wraps the body in an IIFE so `dbPromise` is assigned
 * synchronously before the first `await` yields. Subsequent callers see
 * the in-flight promise via the truthy check and await it instead of
 * starting their own.
 *
 * The race-safety property tested here: 6 parallel `getDB()` callers in
 * the same tick all resolve to the exact same IDBPDatabase instance.
 * Pre-fix this fails because each caller created its own wrapper.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const REAL_DB_NAME = 'rope-works-inspections';

async function deleteRealDB(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(REAL_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe('getDB race-safety (blocker #3)', () => {
  beforeEach(async () => {
    // Fresh module state so `dbPromise` starts null.
    vi.resetModules();
    // Fresh IDB so the v0→v18 upgrade runs cleanly.
    await deleteRealDB();
  });

  afterEach(async () => {
    await deleteRealDB();
  });

  it('parallel getDB() callers in the same tick resolve to the same IDBPDatabase instance', async () => {
    const { getDB } = await import('../offline-storage');

    // Fire 6 parallel callers in the same synchronous tick — mirrors the
    // InspectionForm offline-save fan-out
    // (`saveInspectionOffline` + 5×`saveRelatedDataOffline`).
    const dbs = await Promise.all([
      getDB(),
      getDB(),
      getDB(),
      getDB(),
      getDB(),
      getDB(),
    ]);

    // All callers must receive the SAME db instance.
    const first = dbs[0];
    for (const db of dbs) {
      expect(db).toBe(first);
    }
  });

  it('sequential getDB() callers also share the cached IDBPDatabase instance', async () => {
    const { getDB } = await import('../offline-storage');

    const db1 = await getDB();
    const db2 = await getDB();
    const db3 = await getDB();

    expect(db2).toBe(db1);
    expect(db3).toBe(db1);
  });

  it('parallel getDB() callers issued before any await still share the same in-flight promise', async () => {
    const { getDB } = await import('../offline-storage');

    // No await between the calls — they all see the same `dbPromise`
    // immediately because it is assigned synchronously inside the IIFE.
    const promises = [getDB(), getDB(), getDB(), getDB(), getDB(), getDB()];
    const resolved = await Promise.all(promises);
    const first = resolved[0];
    for (const db of resolved) {
      expect(db).toBe(first);
    }
  });
});
