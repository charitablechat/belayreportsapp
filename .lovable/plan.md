

# Fix Snapshot Reliability & Add Hard Save to Device

## Problem Analysis

The snapshot pipeline (`performSave` → `saveReportSnapshot` → `uploadSnapshotToCloud`) is already wired in all three form types. However:

1. **Cloud upload failures are completely silent** — the `_doUpload` catch swallows all errors with no logging, making it impossible to diagnose why cloud snapshots aren't appearing
2. **No bulk "Save to Device" action** — individual export buttons exist but there's no way to download all snapshots at once as a device backup
3. **No visibility into snapshot health** — users can't tell if snapshots are actually being written on each save

## Changes

### 1. Add error logging to cloud upload (`src/lib/cloud-backup.ts`)

The fire-and-forget catch currently swallows errors silently. Add `console.warn` so failures are diagnosable:

```typescript
_doUpload(reportType, reportId, snapshot).catch((err) => {
  console.warn('[Cloud Backup] Upload failed (non-blocking):', err);
});
```

### 2. Add "Download All to Device" button (`src/components/admin/DataRecoveryTool.tsx`)

Add a button to `LocalSnapshotsPanel` header that bundles all local snapshots into a single JSON file and triggers a browser download. This serves as the "hard save/backup to local drive" feature.

Also add the same capability to `CloudSnapshotsPanel` — download all cloud snapshots as a single JSON bundle.

### 3. Add production-level snapshot logging (`src/lib/local-backup-ledger.ts`)

Remove the `DEV`-only gate on the console.log so snapshot writes are visible in production logs too (helps diagnose "not saving" issues). Change to a lightweight `console.debug` that won't clutter but is available when needed.

## Files Changed

- `src/lib/cloud-backup.ts` — add error logging to catch block
- `src/lib/local-backup-ledger.ts` — upgrade snapshot write logging from DEV-only to console.debug
- `src/components/admin/DataRecoveryTool.tsx` — add "Download All to Device" button to both Local and Cloud snapshot panels

