/**
 * Helpers extracted from PhotoGallery.tsx so the per-item background-cache
 * logic can be exercised by vitest without mounting the React component.
 *
 * Audit H1 belongs here: when HEIC→JPEG conversion fails, we must NOT cache
 * the raw HEIC blob locally — iOS Safari renders `<img src={blob:…}>` as a
 * black placeholder when the underlying bytes are HEIC, even though it
 * happily renders the same bytes when served from a network signed-URL with
 * `Content-Type: image/heic`. Caching the raw HEIC poisons every subsequent
 * render. Letting the cache miss means the next loadPhotos() falls back to
 * the (renderable) signed URL and re-attempts conversion.
 */

export interface BackgroundCacheDeps {
  blob: Blob;
  photoId: string;
  photoStoragePath: string;
  inspectionId: string;
  section: string;
  isHeicPath: (path: string) => boolean;
  isHeicBlob: (blob: Blob) => Promise<boolean>;
  convertHeicBlobToJpeg: (blob: Blob, quality?: number) => Promise<Blob | null>;
  reuploadConvertedJpeg: (path: string, blob: Blob) => void;
  cachePhotoFromRemote: (
    id: string,
    blob: Blob,
    path: string,
    inspectionId: string,
    section: string
  ) => Promise<unknown>;
}

/**
 * Process a single photo blob fetched from a signed URL: detect HEIC,
 * attempt conversion, re-upload the JPEG (best-effort), and cache.
 *
 * Returns a CacheOutcome describing what happened so callers / tests can
 * verify the H1 contract: failed HEIC conversions MUST skip the cache write.
 */
export type CacheOutcome =
  | { kind: 'cached'; converted: boolean }
  | { kind: 'skipped-heic-conversion-failed' };

export async function processBackgroundCacheItem(
  deps: BackgroundCacheDeps
): Promise<CacheOutcome> {
  const {
    blob,
    photoId,
    photoStoragePath,
    inspectionId,
    section,
    isHeicPath,
    isHeicBlob,
    convertHeicBlobToJpeg,
    reuploadConvertedJpeg,
    cachePhotoFromRemote,
  } = deps;

  const heicDetected = isHeicPath(photoStoragePath) || (await isHeicBlob(blob));

  if (heicDetected) {
    const jpegBlob = await convertHeicBlobToJpeg(blob, 0.85);
    if (jpegBlob) {
      reuploadConvertedJpeg(photoStoragePath, jpegBlob);
      await cachePhotoFromRemote(photoId, jpegBlob, photoStoragePath, inspectionId, section);
      return { kind: 'cached', converted: true };
    }
    // Audit H1: do NOT cache the raw HEIC blob. See module docstring.
    return { kind: 'skipped-heic-conversion-failed' };
  }

  await cachePhotoFromRemote(photoId, blob, photoStoragePath, inspectionId, section);
  return { kind: 'cached', converted: false };
}
