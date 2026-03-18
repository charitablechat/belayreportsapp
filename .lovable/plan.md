

## Fix: Infinite Spinner on Training Photos Tab

### Root Cause

The HEIC fix from the previous change made `loadPhotos()` synchronously await ALL HEIC conversions before calling `setLoading(false)`. With 108 photos:

1. **Line 222**: Sequential `await isHeicBlob()` on every cached photo — blocks the loop
2. **Lines 251-278**: `await batchConvertHeicBlobs()` converts all detected HEIC photos 3 at a time — `heic2any` is CPU-heavy, ~2-5s per image = **~3 minutes total** before `setLoading(false)` is reached
3. **Lines 351-381**: For uncached photos, fetches each via signed URL, then `await isHeicBlob()` + `await convertHeicBlobToJpeg()` in chunks of 3 — another potentially massive blocking operation

All of this happens **before** `setPhotos()` is called (line 392), so the spinner never clears.

### Solution: Progressive Rendering

Decouple HEIC conversion from the initial load. Show photos immediately with their signed URLs (browsers that support HEIC will render them; others show broken images temporarily), then convert in the background and update the UI progressively.

**Changes to `src/components/PhotoGallery.tsx`:**

1. **Remove blocking HEIC conversion from `loadPhotos()`**: 
   - Remove the `await isHeicBlob()` check inside the cached photo loop (line 222) — just display the cached blob as-is
   - Remove the `await batchConvertHeicBlobs()` block (lines 251-278)
   - Remove the uncached HEIC conversion loop (lines 345-382)
   - Let `setPhotos()` and `setLoading(false)` execute immediately

2. **Add a post-render background conversion effect**:
   - New `useEffect` that runs after photos are loaded and `loading` is false
   - Iterates through displayed photos, fetches each blob, runs `isHeicBlob()` magic byte check
   - Converts HEIC photos to JPEG via `convertHeicBlobToJpeg()` one at a time (or 2 concurrent)
   - Updates individual photo URLs in state progressively via `setPhotos(prev => ...)` 
   - Fires `reuploadConvertedJpeg()` for each converted photo (fire-and-forget)
   - Uses an abort controller to cancel if the component unmounts

3. **Move the background caching `doCaching` logic** to also handle HEIC detection during caching (already partially does this) — but don't block on it

### Files Changed

| File | Change |
|------|--------|
| `src/components/PhotoGallery.tsx` | Remove blocking HEIC conversion from loadPhotos; add post-render progressive conversion effect |

