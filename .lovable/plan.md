

## Offline Image Caching for Systems & Equipment Photos

### Problem
`ItemPhotoUpload` fetches a signed URL from the server on every mount. If the device is offline or the request times out, the thumbnail shows nothing. The `photo-cache.ts` utility already exists with IndexedDB-based caching but is never used by this component.

### Solution
Integrate the existing `photo-cache.ts` into `ItemPhotoUpload` with a cache-first strategy:

1. **On mount** (when `photoUrl` exists): Check IndexedDB for a cached blob before hitting the network.
2. **Cache hit**: Create an object URL from the cached blob and display immediately — skip network call.
3. **Cache miss / stale**: Fetch the signed URL from the server, download the blob, cache it to IndexedDB via `cachePhotoFromRemote`, then display.
4. **Offline + no cache**: Show a placeholder icon instead of a broken image.

### Files Changed

| File | Change |
|------|--------|
| `src/components/inspection/ItemPhotoUpload.tsx` | Rewrite `loadSignedUrl` to check IndexedDB cache first; on remote success, fetch blob and call `cachePhotoFromRemote`; on upload, also cache the compressed blob locally |
| `src/lib/photo-cache.ts` | Add `getCachedPhotoBlob(photoId)` helper that returns the blob directly from IndexedDB (avoids callers needing to import `getDB`) |

### Technical Detail

**ItemPhotoUpload.tsx — `loadSignedUrl` rewrite:**
```typescript
const loadSignedUrl = useCallback(async () => {
  if (!photoUrl) { setSignedUrl(null); return; }
  
  const cacheKey = photoUrl; // storage path is unique per photo
  
  // 1. Try IndexedDB cache first
  const cachedBlob = await getCachedPhotoBlob(cacheKey);
  if (cachedBlob) {
    setSignedUrl(URL.createObjectURL(cachedBlob));
    return; // instant display, no network needed
  }
  
  // 2. Fetch from server
  if (!navigator.onLine) return; // offline + no cache — leave blank
  try {
    const { data } = await supabase.storage
      .from("inspection-photos")
      .createSignedUrl(photoUrl, 3600);
    if (!data?.signedUrl) return;
    setSignedUrl(data.signedUrl);
    
    // 3. Download blob and cache for offline use
    try {
      const resp = await fetch(data.signedUrl);
      if (resp.ok) {
        const blob = await resp.blob();
        await cachePhotoFromRemote(cacheKey, blob, photoUrl, inspectionId, 'item-photo');
      }
    } catch { /* non-critical — display still works via signed URL */ }
  } catch { /* silent fail */ }
}, [photoUrl, inspectionId]);
```

**photo-cache.ts — new helper:**
```typescript
export async function getCachedPhotoBlob(photoId: string): Promise<Blob | null> {
  try {
    const db = await getDB();
    const photo = await db.get('photos', photoId);
    if (!photo?.blob || !photo.cachedAt) return null;
    if (Date.now() - photo.cachedAt > CACHE_DURATION) return null;
    return photo.blob;
  } catch { return null; }
}
```

**On upload success** (inside `handleUpload`): Also cache the compressed blob to IndexedDB so it's available offline immediately without a second download.

### Cache Lifecycle
- **Storage**: IndexedDB `photos` store (already exists, shared with the photo sync system)
- **TTL**: 24 hours (existing `CACHE_DURATION` constant)
- **Invalidation**: When device comes back online and TTL expires, next mount fetches fresh signed URL and re-caches
- **Cleanup**: Existing `cleanupStaleCachedPhotos()` already handles eviction of expired entries

