/**
 * Regression — `collectSyncDiagnostics` correctly identifies:
 *  - orphan temp-* records whose inspector_id !== current user
 *  - photos pinned to temp-* parents (and excludes dead-letter retryCount >= 5)
 * It must never throw on partial IDB failure and must coerce uploaded=0|1.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDB, type IDBPDatabase } from 'idb';

let testDb: IDBPDatabase | null = null;

vi.mock('../offline-storage', () => ({
  getDB: async () => testDb,
}));

vi.mock('../cached-auth', () => ({
  getUserWithCache: async () => ({ id: 'user-current' }),
}));

vi.mock('../sync-logger', () => ({
  syncLog: { warn: () => {}, info: () => {}, error: () => {} },
}));

beforeEach(async () => {
  testDb = await openDB(`diag-${Date.now()}-${Math.random()}`, 1, {
    upgrade(db) {
      db.createObjectStore('inspections', { keyPath: 'id' });
      db.createObjectStore('trainings', { keyPath: 'id' });
      db.createObjectStore('daily_assessments', { keyPath: 'id' });
      const photos = db.createObjectStore('photos', { keyPath: 'id' });
      photos.createIndex('by-uploaded', 'uploaded');
    },
  });
});

describe('collectSyncDiagnostics', () => {
  it('finds orphan temp records owned by another user', async () => {
    await testDb!.put('inspections', { id: 'temp-1', inspector_id: 'user-other', organization: 'Acme' });
    await testDb!.put('inspections', { id: 'temp-2', inspector_id: 'user-current', organization: 'Mine' });
    await testDb!.put('inspections', { id: 'real-uuid', inspector_id: 'user-other', organization: 'NotTemp' });
    await testDb!.put('inspections', { id: 'temp-3', inspector_id: 'user-other', organization: 'Soft', deleted_at: '2025-01-01' });

    const { collectSyncDiagnostics } = await import('../sync-diagnostics');
    const r = await collectSyncDiagnostics();
    expect(r.orphanRecords.map((o) => o.id).sort()).toEqual(['temp-1']);
    expect(r.partial).toBe(false);
  });

  it('finds temp-parent photos and skips dead-letter retries', async () => {
    await testDb!.put('photos', { id: 'p1', inspectionId: 'temp-x', uploaded: 0, retryCount: 1 });
    await testDb!.put('photos', { id: 'p2', inspectionId: 'temp-y', uploaded: 0, retryCount: 5 }); // dead-letter
    await testDb!.put('photos', { id: 'p3', inspectionId: 'real-uuid', uploaded: 0, retryCount: 0 });
    await testDb!.put('photos', { id: 'p4', inspectionId: 'temp-z', uploaded: 1, retryCount: 0 }); // already up

    const { collectSyncDiagnostics } = await import('../sync-diagnostics');
    const r = await collectSyncDiagnostics();
    expect(r.tempParentPhotos.map((p) => p.id)).toEqual(['p1']);
  });
});
