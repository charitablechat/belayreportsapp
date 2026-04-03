

# Fix Photo Loading, Unloading & Saving Gaps

## Issues Found

### 1. OptimizedImage: Permanent shimmer on error (no retry, no fallback)
When `<img onError>` fires, `loaded` is set to `false` — the shimmer skeleton shows forever. There's no retry mechanism and no timeout to show a broken-image placeholder. If a signed URL expires mid-session, the photo is permanently stuck on shimmer.

### 2. PhotoGallery: Signed URLs expire after 1 hour with no refresh
Signed URLs are created with `3600` (1 hour). If a user keeps the form open longer than 1 hour, all photos break silently — `OptimizedImage` shows the shimmer skeleton with no recovery path. There's no periodic refresh or re-fetch logic.

### 3. PhotoGallery: `loadPhotos` dependency array missing `isOnline`
The silent refresh effect (line 147-150) calls `loadPhotos(true)` when `isOnline` changes but `loadPhotos` closes over `isOnline` without being in a `useCallback` with `isOnline` as a dependency — it captures the stale value. This means going offline→online may not properly fetch server photos.

### 4. cleanupStaleCachedPhotos uses full table scan (`getAll`)
`photo-cache.ts` line 114 calls `db.getAll('photos')` which loads every photo record (including blobs) into memory. On devices with hundreds of photos, this can cause memory pressure and crashes — especially on iPad Safari with its ~350MB WebView limit.

### 5. CameraCaptureDialog: Canvas not zeroed after capture
After `canvas.toBlob()`, the canvas retains its backing store in memory. On iPad Safari (256MB canvas limit), repeated captures without zeroing can exhaust canvas memory and cause the camera to fail silently.

### 6. ItemPhotoUpload: Hard-delete instead of soft-delete
`handleRemove` (line 261) calls `supabase.storage.remove()` and `supabase.from().delete()` — a permanent hard delete. This is inconsistent with PhotoGallery which uses soft-delete with 60-day retention. Users lose the safety net for item photos.

### 7. syncPhotos re-queries full unuploaded list per photo (N+1)
Line 114 in `sync-manager.ts` calls `getUnuploadedPhotos()` inside the `for` loop for every single photo — a full IndexedDB index query per batch item. With 10 photos this is 10 extra queries that can stall on mobile.

### 8. PhotoGallery: Background HEIC conversion re-fetches already-loaded blobs
The background HEIC conversion effect (line 164-225) fetches photo blobs from network (`fetch(photo.photoUrl)`) for server photos that were just loaded via signed URLs. This doubles bandwidth for every HEIC photo.

## Proposed Fixes

### File: `src/components/ui/optimized-image.tsx`
- Add error state with retry: on error, wait 3 seconds then retry once. After second failure, show a broken-image icon instead of infinite shimmer.
- Add a `src` change detection that resets `loaded` only when the URL domain/path changes (not just query params from URL rotation).

### File: `src/components/PhotoGallery.tsx`
- **Signed URL refresh**: Add a 45-minute interval that calls `loadPhotos(true)` silently to refresh signed URLs before they expire.
- **Wrap `loadPhotos` in `useCallback`** with `isOnline` in the dependency array so the silent network-change refresh captures the correct online state.
- **Background HEIC**: Skip the network fetch for photos that already have a blob from the initial load — use the cached blob directly.

### File: `src/lib/photo-cache.ts`
- Replace `db.getAll('photos')` in `cleanupStaleCachedPhotos` with a cursor-based approach that processes records one at a time, avoiding loading all blobs into memory.

### File: `src/components/ui/camera-capture-dialog.tsx`
- Zero the canvas dimensions (`canvas.width = 0; canvas.height = 0`) after `toBlob` completes to release the backing store immediately.

### File: `src/components/inspection/ItemPhotoUpload.tsx`
- Change `handleRemove` from hard-delete to soft-delete (set `deleted_at` + `retention_until`) to match PhotoGallery's 60-day retention policy.

### File: `src/lib/sync-manager.ts`
- Remove the per-photo `getUnuploadedPhotos()` re-check (N+1 query). Instead, collect uploaded IDs in a `Set` and skip if the ID was already processed by the background thread.

## Summary of Changes

| File | Change |
|------|--------|
| `optimized-image.tsx` | Error retry + broken-image fallback |
| `PhotoGallery.tsx` | 45-min signed URL refresh, fix `isOnline` closure, skip redundant HEIC fetch |
| `photo-cache.ts` | Cursor-based cleanup instead of `getAll` |
| `camera-capture-dialog.tsx` | Zero canvas after capture |
| `ItemPhotoUpload.tsx` | Soft-delete instead of hard-delete |
| `sync-manager.ts` | Remove N+1 re-check query |

