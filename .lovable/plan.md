

# Refine Photo Handling in Daily Backup System

## The Gap

The daily backup system (`scheduled-backup-notify`) backs up:
- All 40+ database tables as JSON (including photo **metadata** rows from `inspection_photos`, `training_photos`, `daily_assessment_photos`)
- HTML reports with embedded Base64 photos

But the **raw photo blobs** stored in the three storage buckets (`inspection-photos`, `training-photos`, `daily-assessment-photos`) are **never archived**. If storage is lost, the metadata records point to files that no longer exist. The HTML reports contain embedded photos, but only for completed reports — draft/in-progress report photos have zero backup.

The Make.com webhook only receives a download URL for the JSON+HTML archive — no photo data.

## Proposed Fix: Add Photo Storage Sync to Backup

### New Edge Function: `backup-photo-storage`

A dedicated edge function that copies all photo blobs from the three source buckets into the `database-backups` bucket under the daily backup folder. This runs as a separate step called from `scheduled-backup-notify` after the JSON export completes.

**Strategy:**
1. List all files in each of the 3 photo buckets (paginated, 1000 at a time)
2. For each file, check if it already exists in `database-backups/daily/{timestamp}/photos/{bucket}/{path}` — skip if present (idempotent)
3. Download blob from source bucket → upload to backup bucket
4. Process in batches of 5 concurrent copies to avoid memory pressure
5. Return a manifest of copied files with sizes and any errors
6. Has a configurable timeout safety valve (4 minutes) — if time runs out, it stops gracefully and reports partial results

**File:** `supabase/functions/backup-photo-storage/index.ts`

### Modify: `scheduled-backup-notify/index.ts`

Add a new Step (between current Steps 1 and 2) that invokes `backup-photo-storage` via an internal edge function call. Results are included in the email summary and manifest.

- Add photo backup stats to email HTML (total photos copied, total size, any failures)
- Add photo manifest to the `manifest.json` uploaded to storage
- Include photo backup signed URL in the Make.com webhook payload

### Add "Download All Photos" Button to Admin Panel

**File:** `src/components/admin/DatabaseBackupsPanel.tsx`

Add a button that generates signed download URLs for all photos in a backup folder and triggers a batch download (or a ZIP if the function supports it). This serves as the manual fallback when the automated sync encounters issues.

### Soft-Deleted Photo Exclusion

Skip photos where the corresponding database record has `deleted_at IS NOT NULL`. This prevents backing up photos that users have already soft-deleted, reducing storage waste.

## Summary of Changes

| File | Change |
|------|--------|
| `supabase/functions/backup-photo-storage/index.ts` | New edge function — copies photo blobs to backup bucket |
| `supabase/functions/scheduled-backup-notify/index.ts` | Call photo backup, add stats to email/manifest/webhook |
| `src/components/admin/DatabaseBackupsPanel.tsx` | Add "Download All Photos" button for manual fallback |

## Edge Cases Handled

- **Large photo counts**: Paginated listing + batch processing with concurrency limit
- **Timeout protection**: 4-minute safety valve with graceful partial completion
- **Idempotency**: Checks if backup copy already exists before re-downloading
- **Memory**: Streams one photo at a time (download → upload → discard), never holds all blobs in memory
- **Soft-deleted photos**: Excluded from backup to save space
- **Network failures**: Per-photo error tracking with retry-on-next-run capability

