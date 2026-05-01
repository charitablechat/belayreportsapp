import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Audit M3: relinkPhotosToNewInspectionId previously returned `0` on IDB
 * boundary failure (silent withIndexedDBErrorBoundary), making "no photos"
 * indistinguishable from "transaction failed". atomic-sync callers
 * `await` but ignore the count, so a real failure left photos orphaned
 * under the temp inspection-id and dead-letter after the next few sync
 * cycles. The fix uses a sentinel return so true boundary-failures throw,
 * letting the outer sync loop retry on the next cycle.
 */

describe('relinkPhotosToNewInspectionId — audit M3 contract', () => {
  beforeEach(() => {
    const req = indexedDB.deleteDatabase('rope-works-inspections');
    return new Promise<void>((resolve) => {
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it('returns 0 (no throw) when there are no photos to relink', async () => {
    const mod = await import('../offline-storage');
    const result = await mod.relinkPhotosToNewInspectionId('temp-x', 'uuid-y');
    expect(result).toBe(0);
  });

  it('relinks photos and rewrites embedded inspection ids in photoUrl', async () => {
    const mod = await import('../offline-storage');

    const blob = new Blob(['x'], { type: 'image/jpeg' });
    await mod.savePhotoOffline({
      id: 'photo-1',
      inspectionId: 'temp-1',
      section: 'systems',
      blob,
      fileName: 'a.jpg',
      photoUrl: 'pending/temp-1/photo-1.jpg',
      uploaded: false,
    });
    await mod.savePhotoOffline({
      id: 'photo-2',
      inspectionId: 'temp-1',
      section: 'systems',
      blob,
      fileName: 'b.jpg',
      photoUrl: 'pending/temp-1/photo-2.jpg',
      uploaded: false,
    });

    const relinked = await mod.relinkPhotosToNewInspectionId('temp-1', 'uuid-2');
    expect(relinked).toBe(2);

    const remaining = await mod.getOfflinePhotos('temp-1');
    expect(remaining.length).toBe(0);

    const moved = await mod.getOfflinePhotos('uuid-2');
    expect(moved.length).toBe(2);
    expect(moved.every((p: { photoUrl?: string }) => p.photoUrl?.includes('uuid-2'))).toBe(true);
    expect(moved.every((p: { photoUrl?: string }) => !p.photoUrl?.includes('temp-1'))).toBe(true);
  });
});
