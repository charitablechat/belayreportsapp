

## Investigation Results: Taylor's Girl Scout Photos

### What I Found

- Taylor's training report (Girl Scouts - Camp La Jita, ID: `35649e1b`) exists and is marked **completed**
- There are **zero** photo records in the `training_photos` database table for this report
- There are **zero** files in the `training-photos` storage bucket — not just for Taylor, but for **anyone**
- The `inspection-photos` bucket has 2,296 files, confirming inspection photo uploads work fine

### Root Cause

The photo retry/sync system (`syncPhotos()` in `sync-manager.ts`) is **hardcoded to only sync to the inspection-photos bucket and inspection_photos table**. When a training or daily assessment photo's initial upload fails (common on mobile due to network conditions), it is never retried correctly because:

1. The IndexedDB `photos` store schema does not store `tableName`, `storageBucket`, or `foreignKeyColumn` — only a generic `inspectionId` field
2. `syncPhotos()` blindly uploads all pending photos to `inspection-photos` bucket and inserts into `inspection_photos` table
3. This means training/daily assessment photos either get uploaded to the **wrong bucket/table** or fail silently

This explains why zero training photos exist anywhere in cloud storage.

### Plan

**1. Extend IndexedDB photo schema** (`src/lib/offline-storage.ts`)
- Add `tableName`, `storageBucket`, and `foreignKeyColumn` fields to the `photos` store schema
- These fields will be stored at capture time so the sync system knows where to upload each photo

**2. Update PhotoCapture to store metadata** (`src/components/PhotoCapture.tsx`)
- Pass `tableName`, `storageBucket`, and `foreignKeyColumn` into `savePhotoOffline()` so each photo record knows its destination

**3. Fix syncPhotos to use per-photo metadata** (`src/lib/sync-manager.ts`)
- Read `tableName`, `storageBucket`, `foreignKeyColumn` from each photo record
- Default to `inspection_photos` / `inspection-photos` / `inspection_id` for backward compatibility with existing IndexedDB records

**4. Update savePhotoOffline function** (`src/lib/offline-storage.ts`)
- Accept and persist the new metadata fields alongside the existing photo data

### Impact
- Fixes training and daily assessment photo uploads for all users
- Existing inspection photos continue working (backward-compatible defaults)
- Taylor will need to re-upload photos for the Girl Scouts report since the originals may no longer be in her device's IndexedDB

