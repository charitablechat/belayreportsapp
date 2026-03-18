

## Root Cause: HEIC Bytes Disguised as JPEG

The previous "fix" via `convert-heic-photos` **only renamed** files from `.heic` to `.jpg` and re-uploaded the **exact same HEIC bytes** with `contentType: 'image/jpeg'`. The comment in the code even admits this:

```
// Strategy: Upload the same bytes with .jpg extension path
// The client heic2any handles actual pixel conversion on display
```

This means:
- **108 photos** in the Girl Scouts training now have `.jpg` paths but contain **HEIC pixel data**
- `isHeicPath()` checks the file extension — sees `.jpg` → skips HEIC conversion → browser gets HEIC bytes it can't render → **black boxes**
- The HTML/PDF report generator creates signed URLs to these files → browser gets HEIC bytes → **black boxes in reports too**
- The client-side "safety net" (heic2any) is never triggered because the path looks like a normal JPEG

### Solution

Two-part fix:

**1. Server-side: Actually convert the pixels** (`supabase/functions/convert-heic-photos/index.ts`)
- Use the [Lovable AI proxy](supported models) with an image-generation-capable model to convert HEIC→JPEG, OR use a simpler approach: fetch each file, detect HEIC by magic bytes (`0x00000018667479706865`), and use a Deno-compatible image library
- **Simplest reliable approach**: Download each `.jpg` file, check if the bytes are actually HEIC (magic bytes check), and if so, use the Supabase service role to create a signed URL, then use a vision model to re-encode, OR use the `sharp` library via npm specifier in Deno
- Actually the simplest: use **ImageMagick WASM** or just pipe through a canvas-equivalent. But Deno Edge Functions don't have canvas.

**Best practical approach**: Add a **client-side HEIC detection by magic bytes** (not just file extension) so the gallery and report rendering correctly identify and convert these mislabeled files.

**2. Client-side: Detect HEIC by content, not just extension** (`src/lib/heic-converter.ts` + `src/components/PhotoGallery.tsx`)
- Add `isHeicBlob(blob)` that checks the first bytes for HEIC magic bytes (`ftyp heic` / `ftyp heis` / `ftyp mif1`)
- In `PhotoGallery.loadPhotos`, after fetching a blob (cached or via signed URL), run `isHeicBlob()` regardless of file extension
- If HEIC detected, run `convertHeicBlobToJpeg()` and re-cache the converted JPEG
- This fixes gallery display immediately for all 108 photos

**3. HTML report fix** (`supabase/functions/generate-training-html/index.ts`)
- The HTML report runs server-side where `heic2any` isn't available
- Download each photo blob, check magic bytes, and if HEIC, convert to base64 data URI after server-side conversion
- Use a Deno-compatible approach: since we can't use canvas in Deno, use `sharp` via `npm:sharp` or embed photos as base64 after client re-caches correct JPEGs
- **Alternative**: After the client-side fix re-caches proper JPEGs and the user opens the report, have the gallery re-upload the converted JPEG blob back to storage, replacing the fake `.jpg`. Then the HTML report just works.

### Recommended approach (minimal changes, maximum impact)

| Step | File | Change |
|------|------|--------|
| 1 | `src/lib/heic-converter.ts` | Add `isHeicBlob(blob)` — checks first 12 bytes for HEIC/HEIF magic bytes |
| 2 | `src/components/PhotoGallery.tsx` | After fetching any blob (cached or signed URL), run `isHeicBlob()`. If true, convert via `heic2any` and re-cache. Also **re-upload** the converted JPEG to storage (replacing the fake .jpg) so the HTML report works too. |
| 3 | `supabase/functions/generate-training-html/index.ts` | Add a fallback: after getting a signed URL, download the blob server-side, check magic bytes, and if HEIC, skip the photo with a warning OR embed a placeholder. This is a safety net until storage files are replaced. |

The key insight: once step 2 re-uploads real JPEGs to storage, the HTML report (step 3) will work automatically on subsequent generations. Step 3 is just a graceful fallback for the first render before replacement completes.

### Risk
- Re-uploading 108 converted JPEGs from the client could take time on slow connections — should be done in background with concurrency limits
- The `heic2any` library is ~1MB — already loaded for the existing HEIC path, so no new bundle cost

