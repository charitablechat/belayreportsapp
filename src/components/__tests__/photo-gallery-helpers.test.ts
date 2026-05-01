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
