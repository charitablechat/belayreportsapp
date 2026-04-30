import { getDB, putPhotoRecord } from './offline-storage';

// Cache duration: 24 hours
const CACHE_DURATION = 24 * 60 * 60 * 1000;

/**
 * Check if a cached photo is still valid
 */
export async function isCachedPhotoValid(photoId: string): Promise<boolean> {
  const db = await getDB();
  const photo = await db.get('photos', photoId);
  
  if (!photo || !photo.cachedAt) {
    return false;
  }
  
  const age = Date.now() - photo.cachedAt;
  return age < CACHE_DURATION;
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
 * Validate and refresh cached photo if needed
 */
export async function validateCachedPhoto(photoId: string): Promise<boolean> {
  const isValid = await isCachedPhotoValid(photoId);
  
  if (isValid) {
    // Update last validated timestamp
    const db = await getDB();
    const photo = await db.get('photos', photoId);
    if (photo) {
      photo.lastValidated = Date.now();
      // N-G: centralised photo write.
      await putPhotoRecord(db, photo);
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
 * Batch validate multiple cached photos in a single IndexedDB transaction
 * Returns a Set of photo IDs that have valid (non-expired) caches
 */
export async function batchValidateCachedPhotos(photoIds: string[]): Promise<Set<string>> {
  const db = await getDB();
  const validIds = new Set<string>();
  const now = Date.now();
  
  const tx = db.transaction('photos', 'readonly');
  for (const id of photoIds) {
    const photo = await tx.store.get(id);
    if (photo?.cachedAt && (now - photo.cachedAt) < CACHE_DURATION) {
      validIds.add(id);
    }
  }
  await tx.done;
  
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
 * Test-only seam: lets unit tests mock the underlying `getDB` import without
 * having to vi.mock the whole module. Defaults to the real exported `getDB`.
 */
type DbForCleanup = Awaited<ReturnType<typeof getDB>>;
let _getDBForCleanup: () => Promise<DbForCleanup> = getDB;
export function __setGetDBForCleanupForTesting(fn: (() => Promise<DbForCleanup>) | null): void {
  _getDBForCleanup = fn ?? getDB;
}

/**
 * True when the current document is hidden (iOS Safari aggressively suspends
 * background tabs, which auto-aborts any open IDB transaction with
 * "InvalidStateError: The database connection is closing" mid-walk).
 */
function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * True when the error looks like an IDB "closing" / "invalid state" failure.
 * On iOS 18 Safari the page entering bfcache or being suspended fires
 * `InvalidStateError: The database connection is closing` either at
 * `db.transaction()` call time or anywhere inside the cursor walk.
 */
function isIdbClosingError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; message?: unknown };
  if (e.name === 'InvalidStateError') return true;
  if (typeof e.message === 'string' && /database connection is closing|InvalidStateError/i.test(e.message)) {
    return true;
  }
  return false;
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

  let db: DbForCleanup;
  try {
    db = await _getDBForCleanup();
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[Photo Cache] cleanup: getDB failed, skipping', err);
    return 0;
  }

  const now = Date.now();
  let cleanedCount = 0;

  // Open the transaction inside its own try so a connection that closed
  // between `await getDB()` and here aborts cleanly rather than crashing.
  let tx: ReturnType<DbForCleanup['transaction']>;
  try {
    tx = db.transaction('photos', 'readwrite');
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
    let cursor = await tx.store.openCursor();
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
