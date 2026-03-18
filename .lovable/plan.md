
Why you still see black squares (confirmed):
1) The Girl Scouts training (`35649e1b-06d6-4402-b2ce-dc55d3e0a1d0`) still has **128/128 photos stored as `.HEIC`** (`image/heic` in storage metadata).
2) Browsers can’t reliably render HEIC in normal `<img>` tags, so the image component falls back to the dark placeholder.
3) Current client conversion is incomplete:
   - `PhotoGallery` only converts HEIC in the **uncached** path.
   - Cached blobs are reused as-is, and background caching currently stores the original HEIC blob.
4) Upload pipeline still lets HEIC through when conversion times out/fails (`compressImage` returns original file), so new HEIC files continue to be saved.
5) The `convert-heic-photos` backend function is effectively a stub (and currently not deployed), so existing HEIC files were never repaired.

Implementation plan:
1) Stop new HEIC from entering storage
   - Make HEIC conversion “strict”: if conversion fails, do not upload original HEIC.
   - In `PhotoCapture`, reject/notify per-file when result is still HEIC.

2) Fix gallery rendering path (the screen in your screenshot)
   - Convert HEIC for both cached and uncached photos.
   - Cache the **converted JPEG blob** (not original HEIC) so reloads stay fixed.
   - Add conversion concurrency limits to avoid device freezes/timeouts on large batches.

3) Repair existing Girl Scouts photos
   - Implement a real one-time HEIC repair flow for existing rows (convert + re-upload JPEG + update `training_photos.photo_url`).
   - Run it for the Girl Scouts training and verify HEIC count goes to zero.

4) Validate end-to-end
   - Photos tab loads real images (no black placeholders) after refresh.
   - Generated training HTML/PDF photo sections render correctly.
   - Database check confirms no remaining `.heic/.heif` rows for that report.

Technical details (code hotspots):
- `src/components/PhotoGallery.tsx`: cached-vs-uncached split, HEIC conversion branch, background cache write path.
- `src/lib/image-compression.ts`: HEIC fallback currently returns original file on failure/timeout.
- `src/components/PhotoCapture.tsx`: upload uses returned filename/extension directly.
- `supabase/functions/convert-heic-photos/index.ts`: currently reports but does not perform conversion.
