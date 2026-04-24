/**
 * N-G regression — `migratePendingPhotoPaths` MUST coerce `uploaded` via
 * `toUploadedFlag` when rewriting photo rows. Spreading `...photo` without
 * coercion round-trips a legacy boolean `uploaded: false` back into IDB
 * and Safari/spec-strict IDB silently drops the row from the
 * `by-uploaded` index — the next `getUnuploadedPhotos()` misses it.
 *
 * This flow runs during offline→online session reconcile (
 * `verifyAndReconcileOfflineAuth`), when the deterministic synthetic uid
 * gets swapped for the real auth.uid() and every queued photo's
 * `photoUrl` prefix is rewritten to the new uid.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDB, type IDBPDatabase } from 'idb';

// Re-implement the same DB shape as `offline-storage.ts`'s `photos` store so
// `migratePendingPhotoPaths` can open the shared connection via getDB().
// We replace the dynamic-import target before loading `offline-auth`.

let testDbName = '';
let testDb: IDBPDatabase | null = null;

async function openTestPhotosDb(): Promise<IDBPDatabase> {
  testDbName = `test-migrate-pending-photos-${Date.now()}-${Math.random()}`;
  return openDB(testDbName, 1, {
    upgrade(db) {
      const store = db.createObjectStore('photos', { keyPath: 'id' });
      store.createIndex('by-uploaded', 'uploaded');
    },
  });
}

// Minimal shim of `offline-storage` that `migratePendingPhotoPaths`
// dynamically imports. Only `getDB` + `toUploadedFlag` are used.
import { vi } from 'vitest';

vi.mock('../offline-storage', () => ({
  getDB: async () => testDb,
  toUploadedFlag: (v: unknown) => (v ? 1 : 0) as 0 | 1,
}));

import { migratePendingPhotoPaths } from '../offline-auth';

describe('N-G — migratePendingPhotoPaths coerces `uploaded` on rewrite', () => {
  beforeEach(async () => {
    testDb = await openTestPhotosDb();
  });

  afterEach(async () => {
    testDb?.close();
    testDb = null;
  });

  it('legacy boolean `uploaded: false` is rewritten as numeric 0 and remains in by-uploaded(0)', async () => {
    const OLD = 'old-synth-user';
    const NEW = 'real-auth-user';

    await testDb!.put('photos', {
      id: 'p-bool',
      photoUrl: `${OLD}/pending/abc.jpg`,
      uploaded: false as unknown,
    });

    await migratePendingPhotoPaths(OLD, NEW);

    const rewritten = await testDb!.get('photos', 'p-bool');
    expect(rewritten).toBeDefined();
    expect(rewritten.photoUrl).toBe(`${NEW}/pending/abc.jpg`);
    expect(rewritten.uploaded).toBe(0);
    expect(typeof rewritten.uploaded).toBe('number');

    // The actual C1 regression — index lookup must return this row.
    const unuploaded = await testDb!.getAllFromIndex(
      'photos',
      'by-uploaded',
      IDBKeyRange.only(0),
    );
    expect(unuploaded.map((r: { id: string }) => r.id)).toContain('p-bool');
  });

  it('already-numeric `uploaded: 0` is preserved (idempotent)', async () => {
    const OLD = 'old';
    const NEW = 'new';
    await testDb!.put('photos', {
      id: 'p-num',
      photoUrl: `${OLD}/pending/x.jpg`,
      uploaded: 0,
    });

    await migratePendingPhotoPaths(OLD, NEW);

    const r = await testDb!.get('photos', 'p-num');
    expect(r.uploaded).toBe(0);
    expect(r.photoUrl).toBe(`${NEW}/pending/x.jpg`);
  });

  it('undefined `uploaded` is coerced to 0 (not left undefined)', async () => {
    const OLD = 'old';
    const NEW = 'new';
    await testDb!.put('photos', {
      id: 'p-undef',
      photoUrl: `${OLD}/pending/y.jpg`,
      // uploaded deliberately omitted
    });

    await migratePendingPhotoPaths(OLD, NEW);

    const r = await testDb!.get('photos', 'p-undef');
    expect(r.uploaded).toBe(0);
  });

  it('uploaded photos are untouched — no rewrite, index membership preserved', async () => {
    const OLD = 'old';
    const NEW = 'new';
    await testDb!.put('photos', {
      id: 'p-done',
      photoUrl: `${OLD}/uploaded/z.jpg`,
      uploaded: 1,
    });

    await migratePendingPhotoPaths(OLD, NEW);

    const r = await testDb!.get('photos', 'p-done');
    expect(r.photoUrl).toBe(`${OLD}/uploaded/z.jpg`);
    expect(r.uploaded).toBe(1);
  });
});
