

# Include Photos in Local Backup Export & Import

## Summary
Update the "Force Local Backup" download and the Data Recovery "Import" button to support ZIP archives containing both the JSON snapshot and all associated photo files.

## Export Changes

### File: `src/lib/local-backup-ledger.ts`

**Make `downloadReportBackup` async** (returns `Promise<boolean>`):

1. After building the JSON payload, query IndexedDB for all photos belonging to the report using `getOfflinePhotos(reportId)`
2. If photos exist with blobs, build a ZIP using JSZip (already installed):
   - `backup.json` — the existing JSON payload
   - `photos/{photoId}_{fileName}` — each photo blob
3. If no photos found locally but photo metadata references uploaded URLs, attempt to fetch from Supabase storage via signed URLs (5s timeout per photo, skip failures)
4. If zero photos or JSZip fails, fall back to plain JSON download (existing behavior — never break the button)
5. Download the resulting `.zip` file

### Files: `InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`

- Change `downloadReportBackup` calls to `await` (add `async` to handler)
- Add a brief `backupDownloading` loading state to disable the button and show a spinner while photos are collected and zipped

## Import Changes

### File: `src/lib/local-backup-ledger.ts`

**Update `importReportBackup`** to handle both JSON and ZIP inputs:

1. Accept `File` object instead of `string` (or detect by content type / magic bytes)
2. If ZIP: extract `backup.json` for the report data, then iterate `photos/*` entries and save each blob to IndexedDB via `savePhotoOffline()`
3. If plain JSON: existing behavior unchanged
4. Return the same `{ reportType, reportId }` result

### File: `src/components/admin/DataRecoveryTool.tsx`

- Change the file input `accept` attribute from `.json` to `.json,.zip`
- Update `handleImportFile` to pass the `File` object (detect JSON vs ZIP by extension or content)
- Show photo count in the success toast (e.g., "Imported inspection backup with 5 photos")

## No new dependencies needed
- JSZip is already in `package.json`

## Files Changed
1. `src/lib/local-backup-ledger.ts` — async ZIP export + ZIP-aware import
2. `src/components/admin/DataRecoveryTool.tsx` — accept `.zip` files, updated toast
3. `src/pages/InspectionForm.tsx` — async download handler + loading state
4. `src/pages/TrainingForm.tsx` — async download handler + loading state
5. `src/pages/DailyAssessmentForm.tsx` — async download handler + loading state

