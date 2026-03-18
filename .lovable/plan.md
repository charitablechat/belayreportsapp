

## Fix: Batch Signed URL Generation in PhotoGallery

### Root Cause
`loadPhotos` in `PhotoGallery.tsx` calls `supabase.storage.createSignedUrl()` individually for **each** photo inside a `Promise.all` map (lines 204-206). For a report with 168 photos, this fires 168 sequential HTTP requests to generate signed URLs before any image renders. Each request has ~100-300ms latency, creating a 15-50 second waterfall.

### Solution
Replace individual `createSignedUrl` calls with the batch API `createSignedUrls` — a single HTTP request that returns all signed URLs at once.

### Changes to `src/components/PhotoGallery.tsx`

**Replace the photo mapping logic (lines 186-243) with:**

1. Separate photos into two groups: those with valid cache (use local blob) and those needing signed URLs
2. Call `supabase.storage.from(bucket).createSignedUrls(paths, 3600)` **once** for all uncached photos
3. Map the batch response back to Photo objects
4. Fire background caching in a single `requestIdleCallback` loop

```text
Before:  N photos → N createSignedUrl() calls → N round-trips
After:   N photos → 1 createSignedUrls() call  → 1 round-trip
```

**Pseudocode:**
```
// Split into cached vs uncached
const uncachedPhotos = data.filter(p => !validCacheIds.has(p.id));
const cachedPhotos = data.filter(p => validCacheIds.has(p.id));

// One batch call for all uncached
const paths = uncachedPhotos.map(p => p.photo_url);
const { data: signedUrls } = await supabase.storage
  .from(storageBucket)
  .createSignedUrls(paths, 3600);

// Map results back, background-cache in idle callback
```

This reduces ~168 network requests to exactly 1, cutting load time from 15-50s to under 2s.

