

## Root Cause Analysis: Training & Daily Assessment Photos Misrouted

### The Problem

Photos uploaded for training and daily assessment reports are **in cloud storage but invisible** to everyone because they were routed to the wrong bucket and table.

### Evidence Found

| Report | Organization | Misrouted Files |
|--------|-------------|----------------|
| Training `35649e1b` | Girl Scouts - Camp La Jita | **136 files** in wrong bucket |
| Training `20659307` | YMCA Twin Lakes | **168 files** in wrong bucket |
| Training `bfe092de` | Southwest Airlines | **2 files** in wrong bucket |
| Daily Assessment `1a406b1f` | Marble Falls, TX | **41 files** in wrong bucket |

**Total: 347 orphaned photo files**

### Root Cause Chain

1. The old `syncPhotos()` was hardcoded to upload ALL photos to the `inspection-photos` storage bucket and insert into the `inspection_photos` database table
2. The files uploaded successfully to `inspection-photos` storage (no RLS issue)
3. The database INSERT into `inspection_photos` **failed silently** because `inspection_photos.inspection_id` has a **foreign key constraint** to `inspections(id)` — a training UUID is not a valid inspection ID
4. Result: files exist in storage but have **zero database records** pointing to them
5. PhotoGallery queries the database for records, finds none, shows nothing

The code fix from the previous session (routing photos to the correct bucket/table) prevents this from happening for **future** uploads. But the 347 existing files remain orphaned.

### Plan

**1. Create an Edge Function to migrate orphaned photos** (`supabase/functions/migrate-orphaned-photos/index.ts`)

This function will:
- Query `storage.objects` for files in `inspection-photos` bucket where the path matches a training or daily assessment ID
- For each file: copy it from `inspection-photos` to the correct bucket (`training-photos` or `daily-assessment-photos`)
- Insert a corresponding database record in the correct table (`training_photos` or `daily_assessment_photos`)
- Delete the orphaned copy from `inspection-photos`
- Protected by super-admin auth check

**2. Run the migration** via the edge function to recover all 347 photos

### Technical Details

The migration needs to handle:
- Copying binary data between storage buckets (download from source, upload to destination)
- Determining the correct `photo_section` (default to "training" for trainings, "assessment" for daily assessments since the original section info was lost)
- Avoiding duplicates if the function is run multiple times (check if destination record already exists)
- The 3 affected training IDs and 1 affected daily assessment ID specifically

This is a one-time data recovery operation. The underlying code bug was already fixed in the previous session.

