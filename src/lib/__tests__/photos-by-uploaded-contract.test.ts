import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

/**
 * C1 — End-to-end contract enforcement for the `photos.by-uploaded` index.
 *
 * IndexedDB silently drops boolean values from indexes, so every row in the
 * `photos` store must persist `uploaded` as `0 | 1` (numeric). This suite
 * locks the contract at three layers:
 *
 *   1. Write site: `savePhotoOffline` round-trips through the index.
 *   2. Mark site: `markPhotoAsUploaded` flips the row out of the unsynced
 *      bucket and into `IDBKeyRange.only(1)`.
 *   3. Schema migration: legacy rows written under the pre-v16 boolean
 *      contract are rewritten on upgrade and become queryable through the
 *      numeric index.
 *
 * If any of these regress, photo sync silently stalls — the user sees no
 * unsynced badge yet uploads never fire. Treat failures here as P0.
 */

const DB_NAME = 'rope-works-inspections';

function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe('C1 — photos.by-uploaded index contract', () => {
  beforeEach(() => deleteDb());

  it('savePhotoOffline persists uploaded as a number (typeof === "number")', async () => {
    const mod = await import('../offline-storage');
    await mod.savePhotoOffline({
      id: 'contract-1',
      inspectionId: 'insp-1',
      section: 'systems',
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      fileName: 'x.jpg',
      uploaded: false,
    });

    // Read directly through the schema-level get to assert the on-disk shape.
    const all = await mod.getOfflinePhotos('insp-1');
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      expect(typeof (p as any).uploaded).toBe('number');
      expect([0, 1]).toContain((p as any).uploaded);
    }
  });

  it('savePhotoOffline coerces boolean true → 1 and round-trips via IDBKeyRange.only(1)', async () => {
    const mod = await import('../offline-storage');
    // Save one false (uploaded=0) and one true (uploaded=1).
    await mod.savePhotoOffline({
      id: 'flag-0',
      inspectionId: 'insp-flag',
      section: 'systems',
      blob: new Blob(['a'], { type: 'image/jpeg' }),
      fileName: 'a.jpg',
      uploaded: false,
    });
    await mod.savePhotoOffline({
      id: 'flag-1',
      inspectionId: 'insp-flag',
      section: 'systems',
      blob: new Blob(['b'], { type: 'image/jpeg' }),
      fileName: 'b.jpg',
      uploaded: true,
    });

    // Drive the raw index directly to prove the numeric key works on a
    // spec-strict implementation (fake-indexeddb is spec-strict).
    const req = indexedDB.open(DB_NAME);
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('photos', 'readonly');
    const idx = tx.objectStore('photos').index('by-uploaded');
    const synced: any[] = await new Promise((resolve, reject) => {
      const r = idx.getAll(IDBKeyRange.only(1));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const unsynced: any[] = await new Promise((resolve, reject) => {
      const r = idx.getAll(IDBKeyRange.only(0));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();

    expect(synced.find(p => p.id === 'flag-1')).toBeDefined();
    expect(unsynced.find(p => p.id === 'flag-0')).toBeDefined();
    // Cross-bucket leakage check.
    expect(synced.find(p => p.id === 'flag-0')).toBeUndefined();
    expect(unsynced.find(p => p.id === 'flag-1')).toBeUndefined();
  });

  it('markPhotoAsUploaded moves a row from IDBKeyRange.only(0) to only(1)', async () => {
    const mod = await import('../offline-storage');
    await mod.savePhotoOffline({
      id: 'mark-1',
      inspectionId: 'insp-mark',
      section: 'systems',
      blob: new Blob(['c'], { type: 'image/jpeg' }),
      fileName: 'c.jpg',
      uploaded: false,
    });

    const before = (await mod.getUnuploadedPhotos()) as any[];
    expect(before.find(p => p.id === 'mark-1')).toBeDefined();

    await mod.markPhotoAsUploaded('mark-1', 'insp-mark/mark-1.jpg');

    const after = (await mod.getUnuploadedPhotos()) as any[];
    expect(after.find(p => p.id === 'mark-1')).toBeUndefined();

    // And the row is now indexed under 1.
    const req = indexedDB.open(DB_NAME);
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('photos', 'readonly');
    const idx = tx.objectStore('photos').index('by-uploaded');
    const synced: any[] = await new Promise((resolve, reject) => {
      const r = idx.getAll(IDBKeyRange.only(1));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();

    const row = synced.find(p => p.id === 'mark-1');
    expect(row).toBeDefined();
    expect(typeof row.uploaded).toBe('number');
    expect(row.uploaded).toBe(1);
  });

  it('toUploadedFlag helper coerces every shape to 0|1', async () => {
    const { toUploadedFlag } = await import('../offline-storage');
    expect(toUploadedFlag(true)).toBe(1);
    expect(toUploadedFlag(false)).toBe(0);
    expect(toUploadedFlag(1)).toBe(1);
    expect(toUploadedFlag(0)).toBe(0);
    expect(toUploadedFlag(undefined)).toBe(0);
    expect(toUploadedFlag(null)).toBe(0);
    expect(toUploadedFlag('y')).toBe(1);
    expect(toUploadedFlag('')).toBe(0);
  });

  it('schema migration: legacy boolean rows are rewritten to 0|1 on upgrade', async () => {
    // Step 1: open at a pre-v16 version, create the photos store with the
    // boolean-keyed index, and seed two legacy rows.
    const seedReq = indexedDB.open(DB_NAME, 15);
    seedReq.onupgradeneeded = () => {
      const db = seedReq.result;
      const store = db.createObjectStore('photos', { keyPath: 'id' });
      store.createIndex('by-inspection', 'inspectionId');
      store.createIndex('by-uploaded', 'uploaded');
    };
    const seedDb: IDBDatabase = await new Promise((resolve, reject) => {
      seedReq.onsuccess = () => resolve(seedReq.result);
      seedReq.onerror = () => reject(seedReq.error);
    });
    {
      const tx = seedDb.transaction('photos', 'readwrite');
      const store = tx.objectStore('photos');
      store.put({
        id: 'legacy-true',
        inspectionId: 'legacy-insp',
        section: 'systems',
        blob: new Blob(['L'], { type: 'image/jpeg' }),
        fileName: 'L.jpg',
        timestamp: Date.now(),
        uploaded: true, // ← legacy boolean
      });
      store.put({
        id: 'legacy-false',
        inspectionId: 'legacy-insp',
        section: 'systems',
        blob: new Blob(['M'], { type: 'image/jpeg' }),
        fileName: 'M.jpg',
        timestamp: Date.now(),
        uploaded: false, // ← legacy boolean
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    seedDb.close();

    // Step 2: re-open through the application's getDB — triggers v16 upgrade.
    const mod = await import('../offline-storage');
    // Any read via the module path will open the DB at the current schema.
    const all = (await mod.getOfflinePhotos('legacy-insp')) as any[];
    expect(all.length).toBe(2);
    for (const row of all) {
      expect(typeof row.uploaded).toBe('number');
      expect([0, 1]).toContain(row.uploaded);
    }
    const trueRow = all.find(p => p.id === 'legacy-true');
    const falseRow = all.find(p => p.id === 'legacy-false');
    expect(trueRow.uploaded).toBe(1);
    expect(falseRow.uploaded).toBe(0);

    // Step 3: numeric index queries now find the migrated rows.
    const unsynced = (await mod.getUnuploadedPhotos()) as any[];
    expect(unsynced.find(p => p.id === 'legacy-false')).toBeDefined();
    expect(unsynced.find(p => p.id === 'legacy-true')).toBeUndefined();
  });
});
