import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Regression: IndexedDB cannot index boolean values, so prior code that
 * stored `uploaded: false` was invisible to the `by-uploaded` index.
 * This test asserts that savePhotoOffline writes 0|1 and that
 * getUnuploadedPhotos returns the row through the index.
 */

describe('photos.by-uploaded index — boolean → 0|1 coercion', () => {
  beforeEach(() => {
    // Reset fake-indexeddb between tests so each starts from a fresh DB.
    // Re-importing won't reset module-level dbPromise, so we delete the DB.
    const req = indexedDB.deleteDatabase('rope-works-inspections');
    return new Promise<void>((resolve) => {
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it('by-uploaded index returns photos saved with boolean false (legacy callers)', async () => {
    // Force-reset the cached dbPromise inside the module by re-importing fresh.
    const mod = await import('../offline-storage');
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const ok = await mod.savePhotoOffline({
      id: 'photo-1',
      inspectionId: 'insp-1',
      section: 'systems',
      blob,
      fileName: 'a.jpg',
      uploaded: false,
    });
    expect(ok).toBe(true);

    const out = (await mod.getUnuploadedPhotos()) as any[];
    expect(Array.isArray(out)).toBe(true);
    expect(out.find((p: any) => p.id === 'photo-1')).toBeDefined();
  });

  it('by-uploaded index excludes photos after markPhotoAsUploaded', async () => {
    const mod = await import('../offline-storage');
    const blob = new Blob(['y'], { type: 'image/jpeg' });
    await mod.savePhotoOffline({
      id: 'photo-2',
      inspectionId: 'insp-2',
      section: 'systems',
      blob,
      fileName: 'b.jpg',
      uploaded: false,
    });

    await mod.markPhotoAsUploaded('photo-2', 'insp-2/photo-2.jpg');

    const out = (await mod.getUnuploadedPhotos()) as any[];
    expect(Array.isArray(out)).toBe(true);
    expect(out.find((p: any) => p.id === 'photo-2')).toBeUndefined();
  });
});
