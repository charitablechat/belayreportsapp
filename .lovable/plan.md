
Goal: make inspection photos appear exactly once in the photo section while still appearing once beside the related row item.

What I found
1. This is not a camera-only bug. The onboard camera is not the root cause by itself.
   - `CameraCaptureDialog` only creates a `File` and passes it onward.
   - Main photo-section camera captures and file uploads both go through the same shared flow in `src/components/PhotoCapture.tsx`.
   - Row-item camera captures and file uploads both go through the same shared flow in `src/components/inspection/ItemPhotoUpload.tsx`.

2. The main source of persistent duplicate report entries is the upload/sync race in `src/components/PhotoCapture.tsx`.
   - `uploadPhotoInBackground()` uploads to storage, then blindly inserts into `inspection_photos`.
   - At the same time, `useAutoSync -> syncPhotos()` can process the same offline photo and also insert into `inspection_photos`.
   - Result: two DB rows for the same `inspection_id + photo_url + photo_section`, and the report generator renders both.

3. There is also a UI-only dedupe bug in `src/components/PhotoGallery.tsx`.
   - The current merge compares transformed URLs (`object:` URLs / signed URLs), not the real storage path.
   - So the same image can still appear twice in the section gallery during the upload handoff window.

4. The inspection report generator has no final safety net.
   - `supabase/functions/generate-inspection-html/index.ts` fetches all `inspection_photos` rows and renders them as-is.
   - Any historical duplicates already in the database will keep showing in reports until cleaned or deduped at render time.

5. The prior cleanup is incomplete for this request.
   - It cleans duplicate rows, but it does not protect the shared `PhotoCapture` flow.
   - It does not fix the broken gallery merge logic.
   - It does not invalidate/regenerate stored report content for affected inspections.

Implementation plan

1. Fix the actual insertion race for future uploads
   - File: `src/components/PhotoCapture.tsx`
   - Add the same dedup guard already used in `ItemPhotoUpload` before inserting into `inspection_photos`.
   - Treat duplicate-insert failures as success, not as a retryable error.
   - Mark the offline photo as uploaded once the storage path is confirmed and the DB row already exists or is inserted.
   - This fixes both “Take Photo” and “Upload” in the main photo sections because they share this code.

2. Make sync idempotent even if two writers overlap
   - File: `src/lib/sync-manager.ts`
   - Keep the pre-insert existence check, but also handle unique-conflict errors gracefully.
   - If another path already inserted the same photo row, the sync path should mark the photo uploaded and continue instead of retrying.
   - This closes the remaining race window between immediate upload and auto-sync.

3. Fix the gallery merge so one section photo only renders once on-screen
   - File: `src/components/PhotoGallery.tsx`
   - Stop deduping by signed/object URL.
   - Preserve the raw storage path for both offline and DB photos, then dedupe pending offline entries against DB `photo_url`.
   - This prevents transient double display in the section gallery while preserving the separate row-item thumbnail.

4. Add a final report-generation safety net
   - File: `supabase/functions/generate-inspection-html/index.ts`
   - Before rendering the photo page, dedupe gallery photos in memory by a stable key:
     `photo_url + photo_section` (or equivalent normalized key).
   - Keep row-item thumbnails untouched.
   - Result: the report will still show one row-item thumbnail and one single gallery entry, even if old duplicate rows slipped through.

5. Apply the fix retroactively to existing inspection data
   - Database/data work:
     - Run a one-time cleanup on `inspection_photos` that soft-deletes duplicate active rows, keeping the earliest row per `(inspection_id, photo_url, photo_section)`.
     - Keep schema work separate from data cleanup:
       - schema migration for the unique active-photo index
       - data operation for the one-time duplicate cleanup
   - Add/verify a unique active-photo index so duplicates cannot be stored again.

6. Refresh existing report outputs so current inspections stop showing old duplicates
   - For inspections touched by the cleanup, invalidate stored generated report content (`latest_report_html`, and any saved inspection report artifact references that should no longer be trusted) so the next generated/opened report is rebuilt from deduped data.
   - This makes the fix retroactive for current inspection records, not just future ones.

Verification plan
1. Test row-item photo via onboard camera:
   - one thumbnail beside the row
   - one entry in the matching photo section
   - one entry in generated inspection HTML/PDF

2. Test row-item photo via file upload:
   - same expected result

3. Test main photo-section camera/photo upload:
   - no duplicate section entries after immediate upload
   - no duplicate after auto-sync runs

4. Test offline -> reconnect sync:
   - no duplicate section photos after background sync completes

5. Test an existing inspection that already has duplicate photo rows:
   - cleanup removes extras
   - regenerated report shows only one gallery copy

Technical details
- Files to update:
  - `src/components/PhotoCapture.tsx`
  - `src/lib/sync-manager.ts`
  - `src/components/PhotoGallery.tsx`
  - `supabase/functions/generate-inspection-html/index.ts`
- Database/data work:
  - one schema migration for the unique active-photo guard
  - one one-time data cleanup for duplicate `inspection_photos`
  - invalidate stale stored report content for affected inspections

Expected outcome
- Root cause identified: shared upload/sync logic, not the onboard camera itself
- Future inspections cannot create duplicate photo-section rows
- Existing duplicate inspection photos are cleaned up
- Generated inspection reports show each photo once in the section gallery, while still keeping the separate row-item thumbnail
