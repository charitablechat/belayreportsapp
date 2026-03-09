

# Import JSON Backup File

## Current State

The app can **export** snapshots as JSON files and **restore** from existing local/cloud snapshots, but there is no way to **import** a previously downloaded JSON file back into the system. The restore logic already exists in `DataRecoveryTool.tsx` — it writes snapshot data to IndexedDB via `saveInspectionOffline`, `saveTrainingOffline`, etc. We just need a file picker to feed that same pipeline.

## Plan

### 1. Add "Import Backup" button to `LocalSnapshotsPanel` (`src/components/admin/DataRecoveryTool.tsx`)

- Add an "Import" button (Upload icon) next to the existing "Save All" button in the panel header
- On click, open a hidden `<input type="file" accept=".json">` file picker
- Parse the uploaded JSON, validate it has the expected structure (`reportType`, `reportId`, `snapshot` with `v`, `ts`, `parent`, `children`)
- On validation success:
  1. Write to localStorage via `saveReportSnapshot()` (restores the local backup ledger entry)
  2. Write to IndexedDB via the existing restore handlers (`saveInspectionOffline`/`saveTrainingOffline`/`saveDailyAssessmentOffline` + child data)
  3. Fire-and-forget cloud upload via `uploadSnapshotToCloud()`
  4. Refresh the snapshots list
  5. Show success toast with report type and ID
- On validation failure: show error toast explaining the file format is invalid

### 2. Also add to `UserDataRecoverySheet`

Since `UserDataRecoverySheet` renders `LocalSnapshotsPanel`, the import button will automatically appear there too — no additional wiring needed.

### Validation Schema

```typescript
// Expected JSON structure from downloadReportBackup():
{
  exportedAt: string,
  reportType: 'inspection' | 'training' | 'daily_assessment',
  reportId: string (UUID),
  snapshot: {
    v: number,
    ts: number,
    synced: boolean,
    device: string,
    parent: Record<string, any>,
    children: Record<string, any[]>
  }
}
```

## Files Changed

- `src/components/admin/DataRecoveryTool.tsx` — add Import button + file handler to `LocalSnapshotsPanel`
- `src/lib/local-backup-ledger.ts` — add `importReportBackup(json: string): boolean` validation + restore utility

