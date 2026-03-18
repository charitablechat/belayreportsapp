

## Fix: Black Photos — HEIC Files Not Browser-Renderable

### Root Cause
All 136 Girl Scouts training photos are `.HEIC` files (Apple's native format). The compression pipeline explicitly **skips** HEIC files (`canProcessWithCanvas` returns false), uploading them raw to storage. Browsers cannot natively render HEIC — resulting in the black boxes you see.

### Solution: Convert HEIC→JPEG Before Upload

**1. Add `heic2any` library** — a client-side HEIC-to-JPEG converter (~50KB).

**2. Modify `src/lib/image-compression.ts`**:
- Instead of returning the original HEIC file unchanged, convert it to JPEG using `heic2any` before the canvas compression step
- The converted JPEG then flows through the normal compression pipeline

```text
Current flow:  HEIC file → canProcessWithCanvas? NO → return raw HEIC → ❌ black box
New flow:      HEIC file → heic2any → JPEG blob → canvas compress → ✅ visible image
```

**3. Modify `src/components/PhotoCapture.tsx`**:
- Update the file name extension from `.HEIC` to `.jpg` after conversion so storage paths reflect the actual format

**4. Fix existing photos** — Create a backend function (`convert-heic-photos`) that:
- Queries all `.HEIC` photo_url entries in `training_photos`
- Downloads each from storage, converts server-side using sharp/ImageMagick, re-uploads as JPEG
- Updates the `photo_url` column to point to the new `.jpg` path
- This is a one-time migration for the 136 existing HEIC files

### Files Changed
| File | Change |
|------|--------|
| `package.json` | Add `heic2any` dependency |
| `src/lib/image-compression.ts` | Add HEIC→JPEG conversion before canvas step |
| `src/components/PhotoCapture.tsx` | Rename output file extension after conversion |
| `supabase/functions/convert-heic-photos/index.ts` | New edge function to convert existing HEIC files in storage |

### Risk
- `heic2any` conversion takes 2-5 seconds per photo on mobile — acceptable since it replaces a broken workflow
- Existing 136 photos will remain black until the edge function migration runs
- The edge function needs to handle HEIC→JPEG conversion server-side (Deno + fetch + re-upload)

