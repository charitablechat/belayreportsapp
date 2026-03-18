

## Why Cloud Backup Snapshots Show "Unsynced" and Photos May Not Persist

### Investigation Findings

**Finding 1: Cloud backup `synced` flag never updates after initial upload**

The `synced` field in `report_cloud_backups` is set once during `uploadSnapshotToCloud()`, which fires at snapshot creation time. At that moment, `synced` reflects `!!training.synced_at` — which is `false` for new or recently-edited reports (since they haven't been pushed to the database yet).

After the background sync completes, `markSnapshotSynced()` in `useAutoSync` updates localStorage but does NOT re-upload to cloud. The cloud copy remains stuck at `synced: false` forever.

This is why the screenshot shows "Unsynced" for reports that have likely already synced to the primary database.

**Finding 2: Photo upload for trainings is structurally correct (no gap)**

The `PhotoCapture` component correctly receives `tableName="training_photos"`, `foreignKeyColumn="training_id"`, and `storageBucket="training-photos"` from `TrainingForm.tsx`. The `savePhotoOffline` call persists this metadata to IndexedDB. The `syncPhotos()` function reads these fields with backward-compatible defaults.

Storage bucket RLS policies exist for `training-photos` allowing authenticated users to upload to their own folder and super admins to manage all files.

Database RLS on `training_photos` allows users to manage photos for their own trainings and super admins to manage all.

**No structural gap found in the photo upload pipeline itself.**

**Finding 3: The "Unsynced" label is misleading — reports may actually be synced**

The `synced` column in `report_cloud_backups` is a cloud backup metadata field, not the primary sync status. The actual sync status lives in the `trainings` table (`synced_at` column). The Data Recovery UI reads from cloud backups, so it shows stale sync status.

### Root Cause Summary

| Issue | Cause |
|-------|-------|
| Reports show "Unsynced" in Data Recovery | `markSnapshotSynced` updates localStorage but never pushes the updated `synced: true` flag to the `report_cloud_backups` table |
| Photos may not display in reports | This was fixed in the previous change (photo relinking + HTML generation). No remaining gap. |

### Plan

**1. Update `markSnapshotSynced` to also push `synced: true` to cloud** (`src/lib/local-backup-ledger.ts`)

After updating the localStorage snapshot, fire-and-forget an update to `report_cloud_backups` setting `synced = true` for the matching `(user_id, report_type, report_id)` row.

**2. Add a cloud sync update helper** (`src/lib/cloud-backup.ts`)

Add a new `markCloudBackupSynced(reportType, reportId)` function that does:
```sql
UPDATE report_cloud_backups SET synced = true
WHERE user_id = auth.uid() AND report_type = $1 AND report_id = $2
```

**3. Backfill existing stale rows** (database migration)

Update all `report_cloud_backups` rows where the corresponding primary record has a non-null `synced_at` to set `synced = true`:
```sql
UPDATE report_cloud_backups rcb SET synced = true
FROM trainings t WHERE rcb.report_id = t.id::text AND rcb.report_type = 'training' AND t.synced_at IS NOT NULL;
-- Repeat for inspections and daily_assessments
```

### Impact
- All existing synced reports will show "Synced" in the Data Recovery panel after the backfill migration
- Future syncs will correctly update the cloud backup's `synced` flag in real time
- No changes needed for photo upload — that pipeline is structurally sound

