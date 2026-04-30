/**
 * Audit H1 regression coverage: when `convertHeicBlobToJpeg` returns null
 * (heic2any failure / timeout), `processBackgroundCacheItem` MUST skip the
 * cache write so the raw HEIC blob never poisons subsequent renders.
 *
 * iOS Safari renders `<img src={blob:…}>` as a black placeholder when the
 * underlying bytes are HEIC. The signed-URL render works because the network
 * Content-Type tells WebKit's image decoder what to do; the blob: URL has
 * no Content-Type sniffing path. Caching the raw HEIC after a conversion
 * failure is what produced user-reported black-placeholder photos.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  processBackgroundCacheItem,
  type BackgroundCacheDeps,
} from '../photo-gallery-helpers';

function makeDeps(overrides: Partial<BackgroundCacheDeps>): BackgroundCacheDeps {
  return {
    blob: new Blob(['raw'], { type: 'image/heic' }),
    photoId: 'photo-1',
    photoStoragePath: 'user-1/insp-1/photo-1.heic',
    inspectionId: 'insp-1',
    section: 'access',
    isHeicPath: () => false,
    isHeicBlob: async () => false,
    convertHeicBlobToJpeg: async () => new Blob(['jpeg'], { type: 'image/jpeg' }),
    reuploadConvertedJpeg: () => {},
    cachePhotoFromRemote: async () => undefined,
    ...overrides,
  };
}

describe('processBackgroundCacheItem (audit H1)', () => {
  it('caches non-HEIC blobs directly without converting', async () => {
    const cache = vi.fn().mockResolvedValue(undefined);
    const reupload = vi.fn();
    const convert = vi.fn();

    const result = await processBackgroundCacheItem(
      makeDeps({
        blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
        isHeicPath: () => false,
        isHeicBlob: async () => false,
        cachePhotoFromRemote: cache,
        reuploadConvertedJpeg: reupload,
        convertHeicBlobToJpeg: convert,
      })
    );

    expect(result).toEqual({ kind: 'cached', converted: false });
    expect(convert).not.toHaveBeenCalled();
    expect(reupload).not.toHaveBeenCalled();
    expect(cache).toHaveBeenCalledOnce();
  });

  it('caches converted JPEG bytes when HEIC conversion succeeds', async () => {
    const jpegBlob = new Blob(['jpeg'], { type: 'image/jpeg' });
    const cache = vi.fn().mockResolvedValue(undefined);
    const reupload = vi.fn();

    const result = await processBackgroundCacheItem(
      makeDeps({
        photoStoragePath: 'user-1/insp-1/photo-1.heic',
        isHeicPath: (p) => p.endsWith('.heic'),
        convertHeicBlobToJpeg: async () => jpegBlob,
        cachePhotoFromRemote: cache,
        reuploadConvertedJpeg: reupload,
      })
    );

    expect(result).toEqual({ kind: 'cached', converted: true });
    expect(reupload).toHaveBeenCalledWith('user-1/insp-1/photo-1.heic', jpegBlob);
    // The CACHED blob must be the converted JPEG, not the original HEIC.
    expect(cache).toHaveBeenCalledWith(
      'photo-1',
      jpegBlob,
      'user-1/insp-1/photo-1.heic',
      'insp-1',
      'access'
    );
  });

  it('detects HEIC by magic-bytes when extension is misleading (.jpg-but-actually-HEIC)', async () => {
    const jpegBlob = new Blob(['jpeg'], { type: 'image/jpeg' });
    const cache = vi.fn().mockResolvedValue(undefined);

    const result = await processBackgroundCacheItem(
      makeDeps({
        photoStoragePath: 'user-1/insp-1/photo-1.jpg', // misleading
        isHeicPath: () => false,
        isHeicBlob: async () => true, // magic-bytes say HEIC
        convertHeicBlobToJpeg: async () => jpegBlob,
        cachePhotoFromRemote: cache,
      })
    );

    expect(result).toEqual({ kind: 'cached', converted: true });
    expect(cache).toHaveBeenCalledWith(
      'photo-1',
      jpegBlob,
      'user-1/insp-1/photo-1.jpg',
      'insp-1',
      'access'
    );
  });

  it('AUDIT H1: skips the cache write when HEIC conversion returns null', async () => {
    const cache = vi.fn().mockResolvedValue(undefined);
    const reupload = vi.fn();

    const result = await processBackgroundCacheItem(
      makeDeps({
        blob: new Blob(['heic'], { type: 'image/heic' }),
        photoStoragePath: 'user-1/insp-1/photo-1.heic',
        isHeicPath: (p) => p.endsWith('.heic'),
        convertHeicBlobToJpeg: async () => null, // heic2any failed
        cachePhotoFromRemote: cache,
        reuploadConvertedJpeg: reupload,
      })
    );

    expect(result).toEqual({ kind: 'skipped-heic-conversion-failed' });
    // Critical contract: NEVER cache raw HEIC bytes. The cache miss forces
    // the next render to fall back to the signed URL (which IS renderable).
    expect(cache).not.toHaveBeenCalled();
    expect(reupload).not.toHaveBeenCalled();
  });

  it('AUDIT H1: skips cache when conversion fails for a magic-byte-detected HEIC (mislabeled .jpg)', async () => {
    const cache = vi.fn().mockResolvedValue(undefined);

    const result = await processBackgroundCacheItem(
      makeDeps({
        blob: new Blob(['heic'], { type: 'image/jpeg' }), // mislabeled
        photoStoragePath: 'user-1/insp-1/photo-1.jpg',
        isHeicPath: () => false,
        isHeicBlob: async () => true,
        convertHeicBlobToJpeg: async () => null,
        cachePhotoFromRemote: cache,
      })
    );

    expect(result).toEqual({ kind: 'skipped-heic-conversion-failed' });
    expect(cache).not.toHaveBeenCalled();
  });
});

import {
  jpegPathForHeic,
  migrateHeicToJpeg,
  type MigrateHeicToJpegDeps,
} from '../photo-gallery-helpers';

function makeMigrateDeps(
  overrides: Partial<MigrateHeicToJpegDeps> = {}
): MigrateHeicToJpegDeps {
  return {
    photoId: 'photo-1',
    oldStoragePath: 'user-1/insp-1/photo-1.heic',
    jpegBlob: new Blob(['jpeg'], { type: 'image/jpeg' }),
    storageUploadJpeg: async () => ({ error: null }),
    storageRemoveOld: async () => ({ error: null }),
    dbUpdatePhotoUrl: async () => ({ error: null }),
    idbUpdatePhotoUrl: async () => undefined,
    ...overrides,
  };
}

describe('jpegPathForHeic', () => {
  it('rewrites .heic suffix to .jpg', () => {
    expect(jpegPathForHeic('user-1/insp-1/photo-1.heic')).toBe('user-1/insp-1/photo-1.jpg');
  });
  it('rewrites .HEIC (uppercase) suffix to .jpg', () => {
    expect(jpegPathForHeic('user-1/insp-1/photo-1.HEIC')).toBe('user-1/insp-1/photo-1.jpg');
  });
  it('rewrites .heif suffix to .jpg', () => {
    expect(jpegPathForHeic('user-1/insp-1/photo-1.heif')).toBe('user-1/insp-1/photo-1.jpg');
  });
  it('returns null for non-HEIC paths', () => {
    expect(jpegPathForHeic('user-1/insp-1/photo-1.jpg')).toBeNull();
    expect(jpegPathForHeic('user-1/insp-1/photo-1.png')).toBeNull();
    expect(jpegPathForHeic('user-1/insp-1/photo-1')).toBeNull();
  });
});

describe('migrateHeicToJpeg (audit H2)', () => {
  it('skips when the source path is not .heic/.heif', async () => {
    const upload = vi.fn();
    const dbUpdate = vi.fn();
    const idbUpdate = vi.fn();
    const remove = vi.fn();

    const result = await migrateHeicToJpeg(
      makeMigrateDeps({
        oldStoragePath: 'user-1/insp-1/photo-1.jpg',
        storageUploadJpeg: upload,
        dbUpdatePhotoUrl: dbUpdate,
        idbUpdatePhotoUrl: idbUpdate,
        storageRemoveOld: remove,
      })
    );

    expect(result).toEqual({ kind: 'skipped-not-heic-extension' });
    expect(upload).not.toHaveBeenCalled();
    expect(dbUpdate).not.toHaveBeenCalled();
    expect(idbUpdate).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('happy path: uploads to .jpg, updates DB row, updates IDB, deletes old .heic', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const dbUpdate = vi.fn().mockResolvedValue({ error: null });
    const idbUpdate = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue({ error: null });
    const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' });

    const result = await migrateHeicToJpeg(
      makeMigrateDeps({
        photoId: 'photo-42',
        oldStoragePath: 'user-1/insp-1/photo-42.heic',
        jpegBlob: jpeg,
        storageUploadJpeg: upload,
        dbUpdatePhotoUrl: dbUpdate,
        idbUpdatePhotoUrl: idbUpdate,
        storageRemoveOld: remove,
      })
    );

    expect(result).toEqual({
      kind: 'migrated',
      newStoragePath: 'user-1/insp-1/photo-42.jpg',
    });
    expect(upload).toHaveBeenCalledWith('user-1/insp-1/photo-42.jpg', jpeg);
    expect(dbUpdate).toHaveBeenCalledWith('photo-42', 'user-1/insp-1/photo-42.jpg');
    expect(idbUpdate).toHaveBeenCalledWith('photo-42', 'user-1/insp-1/photo-42.jpg');
    // Allow microtasks to flush so the fire-and-forget delete runs.
    await Promise.resolve();
    expect(remove).toHaveBeenCalledWith('user-1/insp-1/photo-42.heic');
  });

  it('writes are sequential: DB row is NOT updated when upload fails', async () => {
    const upload = vi.fn().mockResolvedValue({ error: { message: 'storage 500' } });
    const dbUpdate = vi.fn().mockResolvedValue({ error: null });
    const idbUpdate = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue({ error: null });

    const result = await migrateHeicToJpeg(
      makeMigrateDeps({
        oldStoragePath: 'user-1/insp-1/photo-1.heic',
        storageUploadJpeg: upload,
        dbUpdatePhotoUrl: dbUpdate,
        idbUpdatePhotoUrl: idbUpdate,
        storageRemoveOld: remove,
      })
    );

    expect(result).toEqual({ kind: 'failed-upload', error: 'storage 500' });
    expect(dbUpdate).not.toHaveBeenCalled();
    expect(idbUpdate).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('IDB is NOT updated and old .heic is NOT deleted when DB update fails', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const dbUpdate = vi.fn().mockResolvedValue({ error: { message: 'rls denied' } });
    const idbUpdate = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue({ error: null });

    const result = await migrateHeicToJpeg(
      makeMigrateDeps({
        oldStoragePath: 'user-1/insp-1/photo-1.heic',
        storageUploadJpeg: upload,
        dbUpdatePhotoUrl: dbUpdate,
        idbUpdatePhotoUrl: idbUpdate,
        storageRemoveOld: remove,
      })
    );

    expect(result).toEqual({
      kind: 'failed-db-update',
      error: 'rls denied',
      newStoragePath: 'user-1/insp-1/photo-1.jpg',
    });
    expect(idbUpdate).not.toHaveBeenCalled();
    // Old .heic must NOT be deleted: DB still references it via the old path.
    await Promise.resolve();
    expect(remove).not.toHaveBeenCalled();
  });

  it('IDB failure is surfaced but does NOT roll back storage or DB writes', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const dbUpdate = vi.fn().mockResolvedValue({ error: null });
    const idbUpdate = vi.fn().mockRejectedValue(new Error('IDB closing'));
    const remove = vi.fn().mockResolvedValue({ error: null });

    const result = await migrateHeicToJpeg(
      makeMigrateDeps({
        oldStoragePath: 'user-1/insp-1/photo-1.heic',
        storageUploadJpeg: upload,
        dbUpdatePhotoUrl: dbUpdate,
        idbUpdatePhotoUrl: idbUpdate,
        storageRemoveOld: remove,
      })
    );

    expect(result).toEqual({
      kind: 'failed-idb-update',
      newStoragePath: 'user-1/insp-1/photo-1.jpg',
    });
    // Storage + DB already point at the new path; rolling back would leave
    // the DB pointing at a missing object. Don't delete the old file
    // either, since the cache might still want to be re-validated against
    // it on next load.
    await Promise.resolve();
    expect(remove).not.toHaveBeenCalled();
    expect(dbUpdate).toHaveBeenCalledOnce();
  });

  it('best-effort delete of old .heic does not throw even if storage rejects', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const dbUpdate = vi.fn().mockResolvedValue({ error: null });
    const idbUpdate = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockRejectedValue(new Error('not found'));

    const result = await migrateHeicToJpeg(
      makeMigrateDeps({
        oldStoragePath: 'user-1/insp-1/photo-1.heic',
        storageUploadJpeg: upload,
        dbUpdatePhotoUrl: dbUpdate,
        idbUpdatePhotoUrl: idbUpdate,
        storageRemoveOld: remove,
      })
    );

    expect(result).toEqual({ kind: 'migrated', newStoragePath: 'user-1/insp-1/photo-1.jpg' });
    // Drain the fire-and-forget remove
    await Promise.resolve();
    await Promise.resolve();
    expect(remove).toHaveBeenCalledWith('user-1/insp-1/photo-1.heic');
  });
});
