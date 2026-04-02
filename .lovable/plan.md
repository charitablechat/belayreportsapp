
Assumption: fix both parts of the problem — the training form photo experience in the app, and the training report images generated/stored on the server.

What I found

- Training photos use the shared `PhotoCapture` + `PhotoGallery` flow in `src/pages/TrainingForm.tsx`.
- The client flow is weaker than the newer `ItemPhotoUpload` implementation:
  - `PhotoCapture` uploads immediately even when the training still has a `temp-...` id, which can fail the DB insert for `training_photos`.
  - It does not persist the final storage path before upload, so retries can drift and create inconsistent local/server state.
  - It auto-downloads every photo to the device via `saveToDevice()`, which is risky on iPhone Safari and could explain the crash screenshot.
- `PhotoGallery` currently assumes every offline photo still has a blob and calls `URL.createObjectURL(p.blob)`. But `markPhotoAsUploaded()` nulls the blob after sync, so reloading a training with uploaded photos can break gallery loading.
- Server-side training report image handling is also inconsistent with inspection reports:
  - `generate-training-html` embeds expiring signed URLs, so stored/latest HTML reports can lose images later.
  - `generate-training-pdf` base64-encodes images with a `reduce(...)` string build, which is fragile for larger files and should use the chunked helper already used elsewhere.

Implementation plan

1. Fix the training photo upload flow in the app
- Update `src/components/PhotoCapture.tsx` to follow the safer pattern already used by `ItemPhotoUpload`:
  - resolve a deterministic storage path before upload,
  - write that path into IndexedDB first,
  - defer cloud upload when the training id is still temporary,
  - only mark the photo uploaded after storage + DB row both succeed.
- Trigger a gallery refresh after successful background upload so photos move from Pending to Synced without needing a page reload.
- Remove or gate the automatic `saveToDevice()` step so photo capture does not trigger unwanted mobile-download behavior.

2. Fix training gallery loading/reload behavior
- Update `src/components/PhotoGallery.tsx` so it only creates object URLs for entries that actually have a blob.
- Ignore uploaded IndexedDB records whose blob was intentionally released, and load those from server/cache instead.
- Make the loader resilient so one bad photo record does not fail the entire gallery.

3. Fix server-stored training report images
- Update `supabase/functions/generate-training-html/index.ts` to match the inspection report strategy:
  - download each training photo from storage,
  - skip HEIC-disguised files as needed,
  - convert bytes to base64 using the chunked helper,
  - embed `data:` URIs instead of temporary signed URLs.
- This will make saved/latest HTML reports keep their images reliably.

4. Harden training PDF image generation
- Update `supabase/functions/generate-training-pdf/index.ts` to use chunk-based base64 conversion instead of `imgArray.reduce(...)`.
- Keep per-photo failure isolation so one bad image does not break the full PDF.

Technical details
- Files to update:
  - `src/components/PhotoCapture.tsx`
  - `src/components/PhotoGallery.tsx`
  - `supabase/functions/generate-training-html/index.ts`
  - `supabase/functions/generate-training-pdf/index.ts`
  - shared helper import from `supabase/functions/_shared/report-layout.ts` if reused directly
- No database migration appears necessary; the issue looks like client upload logic + training report rendering logic, not schema/RLS.

Validation
- Test uploading a training photo to an existing synced training.
- Test uploading photos to a new/offline training, then syncing after the temp id becomes a real id.
- Reload the training page and confirm photos still render.
- Generate training HTML and PDF and confirm images appear in both the live output and the stored/latest report version.
