

## Root Cause Analysis: Training & Daily Assessment Photos Not Syncing

### Problem
Taylor uploaded photos to the Girl Scouts training report, but they never appeared. Investigation reveals **two distinct bugs**:

### Bug 1: Photo relinking missing for training and daily assessment sync

When a report is created offline, it gets a `temp-*` ID. During sync, this temp ID is replaced with a real UUID. For **inspections**, `relinkPhotosToNewInspectionId()` is called (line 616) to update photo records in IndexedDB so `syncPhotos()` can find and upload them under the correct ID.

For **trainings** (line 1296-1317) and **daily assessments** (line 1934-1955), this call is completely missing. Photos remain keyed under the old `temp-*` ID, so `syncPhotos()` uploads them with a non-existent parent ID, causing a silent foreign key mismatch or orphaned upload.

### Bug 2: Training HTML report generator ignores photos entirely

The `generate-training-html` edge function fetches training data via `fetchTrainingData()` but never queries the `training_photos` table. Even if photos were successfully synced, they would not appear in generated reports.

### Plan

**1. Add photo relinking to training sync** (`src/lib/atomic-sync-manager.ts`)
- After the temp-ID cleanup block (~line 1317), add: `await relinkPhotosToNewInspectionId(trainingIdMapping.oldId, trainingIdMapping.newId);`

**2. Add photo relinking to daily assessment sync** (`src/lib/atomic-sync-manager.ts`)
- After the temp-ID cleanup block (~line 1955), add: `await relinkPhotosToNewInspectionId(assessmentIdMapping.oldId, assessmentIdMapping.newId);`

**3. Add photo rendering to training HTML report** (`supabase/functions/generate-training-html/index.ts`)
- Query `training_photos` table for the training ID
- Generate signed URLs for each photo
- Render a "Photos" section in the HTML output with images and captions

**4. Add photo rendering to training PDF report** (`supabase/functions/generate-training-pdf/index.ts`)
- Same photo query and rendering logic for PDF output

### Impact
- Fixes all future training and daily assessment photo uploads where temp-ID swap occurs
- Taylor will need to re-upload her Girl Scout photos since the originals are likely no longer in her device's IndexedDB
- Generated training reports will now include uploaded photos

