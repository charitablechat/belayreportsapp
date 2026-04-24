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
 * Clean up stale cached photos using cursor-based iteration
 * to avoid loading all blobs into memory at once (prevents OOM on iPad Safari)
 */
export async function cleanupStaleCachedPhotos(): Promise<number> {
  const db = await getDB();
  const now = Date.now();
  let cleanedCount = 0;
  
  const tx = db.transaction('photos', 'readwrite');
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
  
  if (import.meta.env.DEV && cleanedCount > 0) {
    console.log('[Photo Cache] Cleaned up', cleanedCount, 'stale cached photos');
  }
  
  return cleanedCount;
}
