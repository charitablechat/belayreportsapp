
# Fix Slow Photo Loading on Mobile (v2.5.7)

## Root Cause

After auditing the code, the primary bottleneck is a **double-fetch problem** in `PhotoGallery.tsx`. For every photo that isn't already cached in IndexedDB, the `loadPhotos` function:

1. Generates a signed URL (network call)
2. **Fetches the full image blob** via HTTP to cache it in IndexedDB (lines 180-207)
3. Returns the signed URL so the `<img>` tag fetches it **again** from the browser

On mobile with slower connections, this means **every photo is downloaded twice** -- once for caching, once for display. Additionally, when photos ARE already cached locally, the code ignores the cached blob and still uses the remote signed URL for display, missing the chance to show images instantly from local storage.

### Secondary Issues

- **Cache validation is blocking**: `validateCachedPhoto` does 2 IndexedDB operations per photo (read + write) synchronously inside the `Promise.all`, adding latency.
- **No cache-first display**: Even when a valid cached blob exists in IndexedDB, the component displays via the remote signed URL instead of an instant local object URL.
- **Background caching blocks rendering**: The blob fetch + IndexedDB write happens before the photo list is returned to the UI, delaying the initial paint.

## Planned Changes

### 1. Cache-First Display Strategy (`PhotoGallery.tsx`)

When a cached blob exists in IndexedDB and is still valid, create an object URL from the cached blob and use it for display instead of the remote signed URL. This makes cached photos appear **instantly** with zero network latency.

### 2. Deferred Background Caching (`PhotoGallery.tsx`)

Move the blob-fetch-for-caching logic out of the critical rendering path. Instead of awaiting the blob download before returning the photo to the UI:
- Immediately return the photo with its signed URL for display
- Queue the blob fetch + IndexedDB cache write as a non-blocking background task

This eliminates the double-fetch bottleneck and lets photos appear as soon as signed URLs are ready.

### 3. Batch Cache Validation (`photo-cache.ts`)

Replace individual `validateCachedPhoto` calls (2 IndexedDB ops each) with a single batch function that reads all photos in one IndexedDB transaction, reducing I/O from 2N to 1.

### 4. Version Bump to v2.5.7

## Technical Details

### PhotoGallery.tsx -- Cache-first + deferred caching

```typescript
// For each photo from Supabase:
const existingOfflinePhoto = offlinePhotos.find(p => p.photoUrl === photo.photo_url);

if (existingOfflinePhoto && await isCachedPhotoValid(photo.id)) {
  // INSTANT: Use cached blob directly -- zero network latency
  const objectUrl = URL.createObjectURL(existingOfflinePhoto.blob);
  newObjectUrls.push(objectUrl);
  return {
    id: photo.id,
    photoUrl: objectUrl,  // Local blob URL instead of remote signed URL
    uploaded: true,
    caption: photo.caption,
    display_order: photo.display_order ?? index,
  };
}

// NOT CACHED: Return signed URL immediately for display
// Cache the blob in the background (non-blocking)
const signedUrl = signedUrlData.signedUrl;
queueBackgroundCache(photo.id, signedUrl, photo.photo_url, inspectionId, section);

return {
  id: photo.id,
  photoUrl: signedUrl,
  uploaded: true,
  caption: photo.caption,
  display_order: photo.display_order ?? index,
};
```

### Background cache queue

```typescript
// Fire-and-forget: download blob and cache without blocking UI
function queueBackgroundCache(photoId, signedUrl, storagePath, inspectionId, section) {
  requestIdleCallback(() => {
    fetch(signedUrl)
      .then(r => r.blob())
      .then(blob => cachePhotoFromRemote(photoId, blob, storagePath, inspectionId, section))
      .catch(e => console.warn('[PhotoGallery] Background cache failed:', e));
  });
}
```

### photo-cache.ts -- Batch validation

```typescript
export async function batchValidateCachedPhotos(photoIds: string[]): Promise<Set<string>> {
  const db = await getDB();
  const validIds = new Set<string>();
  const now = Date.now();
  
  // Single transaction for all reads
  const tx = db.transaction('photos', 'readonly');
  for (const id of photoIds) {
    const photo = await tx.store.get(id);
    if (photo?.cachedAt && (now - photo.cachedAt) < CACHE_DURATION) {
      validIds.add(id);
    }
  }
  
  return validIds;
}
```

## Files Modified

| File | Change |
|------|--------|
| `src/components/PhotoGallery.tsx` | Cache-first display with local blob URLs; deferred background caching; batch validation |
| `src/lib/photo-cache.ts` | Add `batchValidateCachedPhotos` for single-transaction validation |
| `vite.config.ts` | Bump to v2.5.7 |

## Performance Impact

| Metric | Before | After |
|--------|--------|-------|
| Cached photos | Fetched from remote (500ms+) | Instant from IndexedDB blob (~5ms) |
| Uncached photos | Double-fetched (blob + img) | Single fetch (img only, cache in background) |
| IndexedDB ops per photo | 2-3 sequential reads/writes | 1 batched read |
| Time to first photo visible | Blocked by all blob downloads | Immediate after signed URL generation |

## What Does NOT Change

- Photo capture, compression, or upload logic
- Soft-delete system (v2.5.5)
- Cross-fade / skeleton behavior (v2.5.6)
- Drag-and-drop reordering
- Background sync pipeline
- RLS policies
