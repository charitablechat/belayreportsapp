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

/**
 * Compute the .jpg storage path that corresponds to a HEIC/HEIF storage path.
 * Returns null when the input does not have a HEIC/HEIF extension — in that
 * case there is nothing to migrate (the bytes are already addressable as the
 * advertised type).
 */
export function jpegPathForHeic(storagePath: string): string | null {
  const match = storagePath.match(/^(.+)\.(heic|heif)$/i);
  if (!match) return null;
  return `${match[1]}.jpg`;
}

/**
 * Audit H2: outcome of migrating a freshly-converted JPEG to a real `.jpg`
 * storage path + DB row + IDB cache entry. Each failure mode is reported
 * separately so callers (and tests) can verify the multi-step write order
 * and that partial failures do not leave inconsistent state.
 */
export type MigrateHeicOutcome =
  | { kind: 'migrated'; newStoragePath: string }
  | { kind: 'skipped-not-heic-extension' }
  | { kind: 'failed-upload'; error: string }
  | { kind: 'failed-db-update'; error: string; newStoragePath: string }
  | { kind: 'failed-idb-update'; newStoragePath: string };

export interface MigrateHeicToJpegDeps {
  photoId: string;
  oldStoragePath: string;
  jpegBlob: Blob;
  storageUploadJpeg: (
    path: string,
    blob: Blob
  ) => Promise<{ error: { message: string } | null }>;
  storageRemoveOld: (path: string) => Promise<{ error: { message: string } | null }>;
  dbUpdatePhotoUrl: (
    photoId: string,
    newPath: string
  ) => Promise<{ error: { message: string } | null }>;
  idbUpdatePhotoUrl: (photoId: string, newPath: string) => Promise<void>;
}

/**
 * Migrate a converted-JPEG blob from its `.heic`/`.heif` source path to a
 * matching `.jpg` storage path, then propagate the new path through the DB
 * row and the IDB photo-cache entry.
 *
 * Audit H2: the previous `reuploadConvertedJpeg` wrote JPEG bytes back to
 * the SAME `.heic` path and never touched the DB. Every gallery render
 * therefore re-detected HEIC, re-fetched, re-converted, and re-uploaded
 * forever. The new contract:
 *
 *   1. Upload JPEG bytes to `<basename>.jpg` with `upsert: false`. If
 *      another tab won the race we let it win and bail out.
 *   2. Update `photo_url` on the matching photos table row so future loads
 *      (this tab and others) skip the HEIC branch entirely.
 *   3. Update the IDB cache entry's `photoUrl`/`fileName` so the cached
 *      blob is keyed against the post-migration path.
 *   4. Best-effort delete the old `.heic` object from storage. Failures
 *      here are tolerable — the DB no longer references it; storage
 *      lifecycle policies or batch cleanup can sweep orphans later.
 *
 * Errors at step 2/3 are surfaced (so a console warn is loud) but do NOT
 * roll back step 1 — a future load can re-attempt the DB update via the
 * same path; the second upload is `upsert: false` no-op safe because the
 * JPEG is already there.
 */
export async function migrateHeicToJpeg(
  deps: MigrateHeicToJpegDeps
): Promise<MigrateHeicOutcome> {
  const newStoragePath = jpegPathForHeic(deps.oldStoragePath);
  if (!newStoragePath) {
    return { kind: 'skipped-not-heic-extension' };
  }

  const upload = await deps.storageUploadJpeg(newStoragePath, deps.jpegBlob);
  if (upload.error) {
    return { kind: 'failed-upload', error: upload.error.message };
  }

  const dbUpdate = await deps.dbUpdatePhotoUrl(deps.photoId, newStoragePath);
  if (dbUpdate.error) {
    return {
      kind: 'failed-db-update',
      error: dbUpdate.error.message,
      newStoragePath,
    };
  }

  try {
    await deps.idbUpdatePhotoUrl(deps.photoId, newStoragePath);
  } catch {
    return { kind: 'failed-idb-update', newStoragePath };
  }

  void deps.storageRemoveOld(deps.oldStoragePath).catch(() => undefined);

  return { kind: 'migrated', newStoragePath };
}

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
