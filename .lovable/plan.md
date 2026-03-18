

## Photo Rendering Gap Analysis — All Report Types

### Current State Summary

I've reviewed the complete photo pipeline across all three report types and the client-side gallery. Here's what I found:

---

### 1. Training Reports — Has HEIC safety net ✅ (with one gap)

**`generate-training-html/index.ts`** has `isHeicBytes()` magic byte detection. It downloads each photo, checks for HEIC bytes, and **skips** mislabeled files with a warning. However, it uses **signed URLs** (not base64 data URIs) for the `<img src>` tags.

**Gap:** Training report uses signed URLs, meaning the browser viewing the HTML report needs to be able to render the image format. If a mislabeled HEIC `.jpg` file hasn't been repaired by the client gallery yet, the server skips it entirely — the photo is **missing** from the report rather than showing a black box. This is better than black boxes but still a data loss in the report output.

**Recommendation:** Convert training photo rendering to use **base64 data URIs** (like inspection reports already do), which guarantees the image bytes are embedded directly. This also makes the report self-contained and viewable offline. This is a significant improvement but **not blocking** — the client-side repair mechanism will fix storage files progressively.

---

### 2. Inspection Reports — Missing HEIC check ⚠️

**`generate-inspection-html/index.ts`** downloads photos and converts them to base64 data URIs (good for self-contained reports). However, it has **no HEIC magic byte detection**. If any inspection photo contains mislabeled HEIC data:

- Line 322: `const photoMime = fileData.type || 'image/jpeg'` — it uses whatever MIME the storage reports
- The base64 data URI would be `data:image/jpeg;base64,[HEIC bytes]` — **black box**

**Gap:** No `isHeicBytes()` check exists. Any mislabeled HEIC inspection photo will render as a black box in the report.

**Fix needed:** Add the same `isHeicBytes()` check from the training generator, and either skip HEIC files with a placeholder or (better) just note it since the client gallery auto-repairs them.

---

### 3. Daily Assessment Reports — No photo support at all ✅ (by design)

**`generate-daily-assessment-html/index.ts`** has no photo-related code whatsoever. The daily assessment report does not include photos. No gap here.

---

### 4. Client-Side Gallery (`PhotoGallery.tsx`) — Working correctly ✅

- Background `useEffect` runs `isHeicBlob()` magic byte check on all loaded photos after render
- Converts HEIC → JPEG via `heic2any` progressively
- `reuploadConvertedJpeg()` fires and forgets to permanently fix storage
- `doCaching` background task also detects HEIC by magic bytes during cache operations
- No blocking — gallery renders instantly, fixes happen progressively

---

### 5. Upload Pipeline (`image-compression.ts`) — Working correctly ✅

- `isHeicFile()` detects HEIC by file type or extension at upload time
- Converts to JPEG via `heic2any` before compression
- All output is forced to `image/jpeg` via canvas
- New uploads will always be `.jpg` with real JPEG bytes

---

### 6. Photo Relinking (`relinkPhotosToNewInspectionId`) — Sound ✅

This operates on IndexedDB records by `inspectionId`, updating the foreign key. It doesn't touch file content or extensions, so it correctly handles both original and converted files.

---

### 7. Batch `createSignedUrls` — Working correctly ✅

`PhotoGallery.tsx` line 300-302 uses a single batch call for all uncached photos. Error handling per-URL is in place (lines 311-314).

---

### Plan: Fix the One Remaining Gap

**File:** `supabase/functions/generate-inspection-html/index.ts`

**Change:** Add `isHeicBytes()` function (same as in the training generator) and check each downloaded photo's buffer before creating the base64 data URI. Skip any files that still contain HEIC bytes with a console warning, matching the training generator's behavior.

This is the only remaining gap. All other pipelines are correctly handling HEIC detection and conversion.

| File | Change |
|------|--------|
| `supabase/functions/generate-inspection-html/index.ts` | Add `isHeicBytes()` check before embedding photo as base64 data URI |

