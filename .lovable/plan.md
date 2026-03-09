

# Snapshot Reliability & Force Local Backup

## Analysis

After auditing all three form types (Inspection, Training, Daily Assessment), the snapshot pipeline is already correctly wired — `saveReportSnapshot` → `uploadSnapshotToCloud` fires on every `performSave` (manual, auto-save interval, immediate save, emergency save). The 10-second auto-save interval is active in all forms. However, there are two gaps:

1. **Cloud upload silently ignores database errors** — `_doUpload` never checks the upsert response's `error` field, so failures go completely undetected
2. **No "Force Local Backup" button in form UI** — the "Save All" download exists in the Data Recovery panel but there's no quick-access button while actively editing a report

## Changes

### 1. Fix cloud upload error detection (`src/lib/cloud-backup.ts`)

`_doUpload` currently ignores the upsert response. Add error checking and surface failures:

```typescript
const { error } = await supabase.from('report_cloud_backups').upsert(...);
if (error) throw new Error(error.message);
```

Also add a callback mechanism so forms can optionally show a non-blocking warning toast when cloud backup fails (using the existing `toastWarning` helper). Rate-limit warnings to once per 60 seconds to avoid spam.

### 2. Add "Force Local Backup" button to form headers (`src/components/inspection/InspectionHeader.tsx` pattern)

Add a small download icon button in each form's action bar that:
- Bundles the current report's localStorage snapshot + cloud snapshot into a JSON file
- Triggers a browser download via `saveToDevice` pattern (Blob → object URL → anchor click)
- Shows a retro-styled "BACKUP SAVED" toast on success

This will be implemented as a shared utility function in `src/lib/local-backup-ledger.ts`:

```typescript
export function downloadReportBackup(reportType, reportId): boolean
```

The function reads the snapshot from localStorage, serializes it, and triggers a download.

### 3. Add cloud sync failure surface to `uploadSnapshotToCloud` (`src/lib/cloud-backup.ts`)

Add an optional `onCloudBackupError` callback registry so forms can subscribe to cloud backup failures and show actionable warnings. Rate-limited to prevent toast flooding during extended connectivity issues.

### 4. Wire the Force Backup button into all three forms

Add a `HardDrive` icon button next to the existing save button in:
- `src/pages/InspectionForm.tsx`
- `src/pages/TrainingForm.tsx`
- `src/pages/DailyAssessmentForm.tsx`

## Files Changed

- `src/lib/cloud-backup.ts` — check upsert error, add error callback registry with rate limiting
- `src/lib/local-backup-ledger.ts` — add `downloadReportBackup()` utility
- `src/pages/InspectionForm.tsx` — add Force Backup button
- `src/pages/TrainingForm.tsx` — add Force Backup button
- `src/pages/DailyAssessmentForm.tsx` — add Force Backup button

