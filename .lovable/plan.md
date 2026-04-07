

# Fix Photo Duplication in Inspection Report Gallery

## Root Cause

There are two duplication vectors:

1. **Race between two insert paths**: `ItemPhotoUpload.uploadInBackground` does a blind `INSERT` into `inspection_photos` with no dedup check. Meanwhile, `syncPhotos` in `sync-manager.ts` can also insert a row for the same photo if it runs before `markPhotoAsUploaded` completes. Both paths insert a row with the same `photo_url`, creating DB-level duplicates.

2. **Gallery merge shows both offline + DB copies**: `PhotoGallery.loadPhotos` merges `pendingPhotos` (IndexedDB, `uploaded=false`) with `supabasePhotos` (DB query). During the window between background upload completing the DB insert and IndexedDB being updated to `uploaded=true`, the same photo appears in both lists.

## Solution

### 1. Add dedup guard to ItemPhotoUpload.uploadInBackground
**File: `src/components/inspection/ItemPhotoUpload.tsx`**

Before the `INSERT` at line 139, check if a row already exists for this `photo_url` + `inspection_id` (same pattern as `syncPhotos` line 155-160). Skip insert if it exists.

### 2. Deduplicate gallery merge in PhotoGallery
**File: `src/components/PhotoGallery.tsx`**

When merging pending offline photos with Supabase photos (line 276-278), filter out any offline photo whose `photoUrl` path matches an existing Supabase photo's `photo_url`. This prevents showing the same image twice during the upload race window.

### 3. Retroactive cleanup: deduplicate existing DB rows
**Create a migration** that removes duplicate `inspection_photos` rows. For each group of rows sharing the same `(inspection_id, photo_url, photo_section)` where `deleted_at IS NULL`, keep only the one with the earliest `created_at` and soft-delete the rest.

Apply the same cleanup to `training_photos` and `daily_assessment_photos` tables.

## Files Changed
- `src/components/inspection/ItemPhotoUpload.tsx` — add dedup check before gallery insert
- `src/components/PhotoGallery.tsx` — deduplicate merged photo list by `photo_url`
- New migration — retroactive cleanup of duplicate rows across all photo tables

## Impact
- Existing duplicate photos in the database will be cleaned up automatically
- Future uploads are protected by dedup guards in both insert paths
- Gallery display is protected by merge-time deduplication regardless of timing

