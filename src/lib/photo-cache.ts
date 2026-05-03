import { getDB, putPhotoRecord } from './offline-storage';
import { isDocumentHidden, isIdbClosingError } from './idb-closing-error';

// Cache duration: 24 hours
const CACHE_DURATION = 24 * 60 * 60 * 1000;

/**
 * Test-only seam (broadened in audit M1 from PR #66): lets unit tests mock
 * the underlying `getDB` import for *all* photo-cache helpers without
 * having to vi.mock the whole module. Defaults to the real exported
 * `getDB`. Backwards-compatible with PR #66's `__setGetDBForCleanupForTesting`.
 */
type DbForPhotoCache = Awaited<ReturnType<typeof getDB>>;
let _getDBForPhotoCache: () => Promise<DbForPhotoCache> = getDB;
export function __setGetDBForPhotoCacheForTesting(fn: (() => Promise<DbForPhotoCache>) | null): void {
  _getDBForPhotoCache = fn ?? getDB;
}

/**
 * Check if a cached photo is still valid.
 *
 * Audit M1: hardened against the iOS Safari IDB-closing race that PR #66
 * fixed in `cleanupStaleCachedPhotos`. If the page is hidden (bfcache /
 * tab-switch / app-backgrounded), we never even open the connection —
 * any open transaction would auto-abort with `InvalidStateError`. If the
 * connection happens to close mid-call, we treat the photo as not cached
 * rather than letting the rejection propagate up to PhotoGallery /
 * PhotoCapture and surface as a console error or stuck spinner.
 */
export async function isCachedPhotoValid(photoId: string): Promise<boolean> {
  if (isDocumentHidden()) return false;
  try {
    const db = await _getDBForPhotoCache();
    const photo = await db.get('photos', photoId);
    if (!photo || !photo.cachedAt) {
      return false;
    }
    const age = Date.now() - photo.cachedAt;
    return age < CACHE_DURATION;
  } catch (err) {
    if (isIdbClosingError(err)) {
      if (import.meta.env.DEV) {
        console.log('[Photo Cache] isCachedPhotoValid skipped — IDB closing');
      }
      return false;
    }
    throw err;
  }
}

/**
 * Cache a photo from remote with timestamp
 */
export async function cachePhotoFromRemote(
  photoId: string,
  blob: Blob,
  photoUrl: string,
  inspectionId: string,
  section: string
): Promise<void> {
  const db = await getDB();
  
  // N-G: centralised photo write so toUploadedFlag is always applied.
  await putPhotoRecord(db, {
    id: photoId,
    inspectionId,
    section,
    blob,
    fileName: photoUrl.split('/').pop() || 'photo.jpg',
    timestamp: Date.now(),
    uploaded: 1,
    photoUrl,
    cachedAt: Date.now(),
    lastValidated: Date.now(),
  });
  
  if (import.meta.env.DEV) {
    console.log('[Photo Cache] Cached photo from remote:', photoId);
  }
}

/**
 * Validate and refresh cached photo if needed.
 *
 * Audit M1: same iOS Safari IDB-closing guard pattern as
 * `isCachedPhotoValid` / `cleanupStaleCachedPhotos`. The lastValidated
 * write is best-effort — a closing-mid-write doesn't invalidate the
 * underlying "photo is still cached" answer, so we still return true.
 */
export async function validateCachedPhoto(photoId: string): Promise<boolean> {
  if (isDocumentHidden()) return false;
  let isValid: boolean;
  try {
    isValid = await isCachedPhotoValid(photoId);
  } catch (err) {
    if (isIdbClosingError(err)) return false;
    throw err;
  }

  if (isValid) {
    // Update last validated timestamp — best-effort. A closing-mid-write
    // shouldn't change the boolean we return: the cache *is* still valid.
    try {
      const db = await _getDBForPhotoCache();
      const photo = await db.get('photos', photoId);
      if (photo) {
        photo.lastValidated = Date.now();
        // N-G: centralised photo write.
        await putPhotoRecord(db, photo);
      }
    } catch (err) {
      if (isIdbClosingError(err)) {
        if (import.meta.env.DEV) {
          console.log('[Photo Cache] lastValidated write skipped — IDB closing');
        }
      } else {
        throw err;
      }
    }
    return true;
  }

  // Cache is stale, should be refreshed
  if (import.meta.env.DEV) {
    console.log('[Photo Cache] Cache expired for photo:', photoId);
  }
  return false;
}

/**
 * Batch validate multiple cached photos in a single IndexedDB transaction.
 * Returns a Set of photo IDs that have valid (non-expired) caches.
 *
 * Audit M1: same iOS Safari IDB-closing guard pattern. If the connection
 * closes mid-walk we return whatever ids we've already accumulated as a
 * partial result — callers (PhotoGallery, PhotoCapture) treat "not in
 * the set" as "need to refetch from network", which is the safe choice.
 * `tx.done` rejects on abort, so we attach a no-throw catch.
 */
export async function batchValidateCachedPhotos(photoIds: string[]): Promise<Set<string>> {
  if (isDocumentHidden() || photoIds.length === 0) return new Set<string>();
  const validIds = new Set<string>();
  const now = Date.now();
  try {
    const db = await _getDBForPhotoCache();
    const tx = db.transaction('photos', 'readonly');
    // tx.done rejects with the abort/InvalidState error if the connection
    // closes; swallow it (we already partially populated `validIds`).
    tx.done.catch((err) => {
      if (!isIdbClosingError(err) && import.meta.env.DEV) {
        console.log('[Photo Cache] batch tx.done rejected:', err);
      }
    });
    try {
      for (const id of photoIds) {
        const photo = await tx.store.get(id);
        if (photo?.cachedAt && (now - photo.cachedAt) < CACHE_DURATION) {
          validIds.add(id);
        }
      }
      await tx.done;
    } catch (err) {
      if (isIdbClosingError(err)) {
        if (import.meta.env.DEV) {
          console.log('[Photo Cache] batchValidate aborted mid-walk — returning partial');
        }
        return validIds;
      }
      throw err;
    }
  } catch (err) {
    if (isIdbClosingError(err)) {
      if (import.meta.env.DEV) {
        console.log('[Photo Cache] batchValidate skipped — IDB closing');
      }
      return validIds;
    }
    throw err;
  }
  return validIds;
}

/**
 * Get a cached photo blob by ID (cache-first helper for components)
 */
export async function getCachedPhotoBlob(photoId: string): Promise<Blob | null> {
  try {
    const db = await getDB();
    const photo = await db.get('photos', photoId);
    if (!photo?.blob || !photo.cachedAt) return null;
    if (Date.now() - photo.cachedAt > CACHE_DURATION) return null;
    return photo.blob;
  } catch { return null; }
}

/**
 * Backwards-compat alias for PR #66's test seam name. New tests should use
 * `__setGetDBForPhotoCacheForTesting`. Both routes set the same underlying
 * ref so legacy and new tests interleave cleanly.
 */
export function __setGetDBForCleanupForTesting(fn: (() => Promise<DbForPhotoCache>) | null): void {
  __setGetDBForPhotoCacheForTesting(fn);
}

/**
 * Clean up stale cached photos using cursor-based iteration
 * to avoid loading all blobs into memory at once (prevents OOM on iPad Safari).
 *
 * Hardened against the iOS 18.7 Mobile Safari lifecycle race where the page
 * entering bfcache (tab switch / app backgrounded / phone lock) closes the
 * IDB connection mid-walk. Specifically:
 *
 *   1. We skip work entirely when `document.visibilityState === 'hidden'`,
 *      so a tick fired by the hourly interval just after the page goes to
 *      background does not start a transaction that is doomed to abort.
 *   2. Every IDB call is in its own try/catch so any
 *      `InvalidStateError: The database connection is closing` —
 *      whether at `db.transaction()`, `tx.store.openCursor()`, `cursor.delete()`,
 *      `cursor.continue()` or `tx.done` — fails soft and returns the
 *      partial-cleanup count rather than rejecting up to the fire-and-forget
 *      caller in `App.tsx`.
 *   3. Any other unexpected error is also swallowed (returns 0) so the next
 *      hourly tick can retry.
 */
export async function cleanupStaleCachedPhotos(): Promise<number> {
  if (isDocumentHidden()) return 0;

  let db: DbForPhotoCache;
  try {
    db = await _getDBForPhotoCache();
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[Photo Cache] cleanup: getDB failed, skipping', err);
    return 0;
  }

  const now = Date.now();
  let cleanedCount = 0;

  // Open the transaction inside its own try so a connection that closed
  // between `await getDB()` and here aborts cleanly rather than crashing.
  // Typed via the generic call to db.transaction so tx.store is correctly inferred.
  let tx!: ReturnType<DbForPhotoCache['transaction']>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx = (db as any).transaction('photos', 'readwrite');
  } catch (err) {
    if (isIdbClosingError(err)) {
      if (import.meta.env.DEV) {
        console.warn('[Photo Cache] cleanup: connection closing, skipping this tick', err);
      }
    } else if (import.meta.env.DEV) {
      console.warn('[Photo Cache] cleanup: transaction() failed, skipping', err);
    }
    return 0;
  }

  try {
    let cursor = await tx.objectStore('photos').openCursor();
    while (cursor) {
      const photo = cursor.value;
      if (photo.cachedAt && photo.uploaded) {
        const age = now - photo.cachedAt;
        if (age > CACHE_DURATION) {
          await cursor.delete();
          cleanedCount++;
        }
      }
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (err) {
    // The `idb` wrapper's `tx.done` is a Promise that rejects when the
    // transaction aborts. We jumped to this catch from inside the cursor
    // walk before reaching `await tx.done`, so the abort-triggered
    // rejection is now floating. Attach a no-op handler before doing
    // anything else so it doesn't surface as an unhandled promise
    // rejection — that's exactly the symptom the user reported.
    tx.done.catch(() => {});
    // Mid-walk failure. Most common shape on iOS 18 Safari is the
    // `InvalidStateError: The database connection is closing` thrown when
    // the tab goes into bfcache between cursor steps. The deletes that
    // already committed remain; the rest will be cleaned on the next tick.
    if (isIdbClosingError(err)) {
      if (import.meta.env.DEV) {
        console.warn('[Photo Cache] cleanup: tx aborted mid-walk (connection closing)', err);
      }
    } else if (import.meta.env.DEV) {
      console.warn('[Photo Cache] cleanup: tx failed mid-walk', err);
    }
    try { tx.abort(); } catch { /* already aborted/auto-aborted */ }
    return cleanedCount;
  }

  if (import.meta.env.DEV && cleanedCount > 0) {
    console.log('[Photo Cache] Cleaned up', cleanedCount, 'stale cached photos');
  }

  return cleanedCount;
}
