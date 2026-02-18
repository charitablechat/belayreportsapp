

# Mobile-First Hard Data Protection: Immutable Local Backup System

## Problem Statement

Reports are primarily created on mobile devices (phones/tablets, iOS and Android). Despite multiple existing safeguards, data can still be lost through several paths: browser cache clearing, IndexedDB eviction under storage pressure, sync operations overwriting local state with empty server responses, or orphan cleanup removing records. The user needs an absolute guarantee that once data is entered, it persists until the user explicitly deletes it.

## Current Architecture (What Already Exists)

The app already has substantial protection:
- IndexedDB as primary local store (with circuit breaker, empty-array guards, temp-ID-only clear restrictions)
- Transaction Manager blocklist preventing server-side deletes on 28 report tables
- Emergency save on page hide/visibility change
- Orphan cleanup with threshold guards, rate limiting, and recovery logs
- Soft-delete pattern with 60-day retention
- Photo receipt system in localStorage

**However**, all of these protections share a single point of failure: IndexedDB itself. If the browser clears IndexedDB (storage pressure, user clearing site data, browser update), ALL local data is gone.

## Solution: Dual-Layer Immutable Backup Architecture

### Layer 1 -- localStorage Snapshot Ledger (Survives IndexedDB Eviction)

**Concept**: Every time a report is saved to IndexedDB, a compressed JSON snapshot of the complete report (parent + all child records) is also written to `localStorage` under a predictable key. localStorage is smaller but more persistent -- browsers are far less aggressive about clearing it compared to IndexedDB.

**New file: `src/lib/local-backup-ledger.ts`**

- `saveReportSnapshot(reportType, reportId, parentData, childData)` -- Serializes and stores a complete report snapshot
- `getReportSnapshot(reportType, reportId)` -- Retrieves a snapshot
- `listAllSnapshots()` -- Returns all stored report IDs and their last-saved timestamps
- `deleteReportSnapshot(reportType, reportId)` -- Only callable from explicit user-initiated delete
- Storage budget: caps total snapshot storage at ~4MB (localStorage limit is typically 5-10MB), using LRU eviction of the oldest *synced* snapshots only. Unsynced snapshots are never evicted.
- Each snapshot stores: report ID, type, timestamp, sync status, and a JSON blob of all parent + child data (excluding photo blobs -- photos use the existing receipt system)

### Layer 2 -- IndexedDB Write-Ahead Log (WAL)

**Concept**: Before any destructive operation (clear, delete, overwrite) in IndexedDB, write the current state of the affected records to a dedicated `_backup` object store. This creates an undo buffer internal to IndexedDB itself.

**Modified file: `src/lib/offline-storage.ts`**

- Add a new `report_backups` object store to the IndexedDB schema (version 7 upgrade)
- Before `saveRelatedDataOffline` deletes existing records and replaces them, snapshot the current records into `report_backups`
- Before `deleteOfflineInspection` / `deleteOfflineTraining` / `deleteOfflineDailyAssessment` removes a record, snapshot it
- Backups are keyed by `{reportType}_{reportId}_{timestamp}` and keep the last 3 versions per report
- A new `restoreFromBackup(reportType, reportId)` function retrieves the most recent backup

### Layer 3 -- Desktop/Web Read-Only Guard

**Concept**: When a report is opened from a desktop/web browser and the report was last edited on a mobile device, the form enforces read-only mode unless the user explicitly clicks "Enable Editing". This prevents accidental overwrites from a desktop session that may have stale or incomplete data.

**Modified files: `src/pages/InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`**

- Check if `last_modified_by` device was mobile (store device type during save)
- If the current device is desktop and the last modifier was mobile, show a banner: "This report was last edited on a mobile device. View only -- click to enable editing."
- This is a soft lock (user can override), not a hard block

### Layer 4 -- Recovery Dashboard Panel

**Concept**: Add a "Data Recovery" section to the existing admin tools that shows all localStorage snapshots and IndexedDB backups, allowing one-click restoration.

**Modified file: `src/components/admin/DataRecoveryTool.tsx`**

- Add a "Local Backups" tab showing all localStorage snapshots with timestamps
- Each entry has a "Restore" button that writes the snapshot back into IndexedDB and triggers a sync
- Shows diff between current IndexedDB state and backup (record counts per child table)

## Implementation Details

### Phase 1: localStorage Snapshot Ledger

```text
Key format: rw_backup_{type}_{id}
Value: JSON { 
  v: 1,                    // schema version
  ts: 1708300000000,       // timestamp
  synced: false,           // sync status at time of snapshot
  device: "mobile",        // device type
  parent: {...},           // parent record
  children: {              // all child arrays
    systems: [...],
    equipment: [...],
    ...
  }
}
```

Integration points:
- Called from `performSave` in each form (after successful IndexedDB write)
- Called from `useEmergencySave` (emergency path)
- Called from auto-save debounce completion

### Phase 2: IndexedDB Write-Ahead Log

New object store in schema version 7:
```
report_backups: { key: string, value: { id, reportType, reportId, timestamp, data } }
```

Integration points:
- `saveRelatedDataOffline` -- snapshot before delete+replace
- `deleteOfflineInspection/Training/Assessment` -- snapshot before delete
- `clearRelatedDataOffline` -- snapshot before clear (even for temp-IDs)

### Phase 3: Desktop Read-Only Guard

- Add `last_device_type` field to saves (value: `isMobile() ? 'mobile' : 'desktop'`)
- Store in both IndexedDB and server-side `inspections.metadata` (or a new column)
- On form load, if `last_device_type === 'mobile'` and current device is desktop, set `isReadOnly = true` with override option

### Phase 4: Recovery Dashboard

- Extend existing `DataRecoveryTool.tsx` with a new "Local Snapshots" tab
- List all `rw_backup_*` keys from localStorage
- Show report type, organization name, last saved timestamp, sync status
- "Restore" button: parse snapshot, write to IndexedDB, trigger sync
- "Export" button: download snapshot as JSON file (ultimate last resort)

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/local-backup-ledger.ts` | CREATE | localStorage snapshot system |
| `src/lib/offline-storage.ts` | MODIFY | Add report_backups store, WAL before destructive ops |
| `src/pages/InspectionForm.tsx` | MODIFY | Integrate snapshot saves, device type tracking |
| `src/pages/TrainingForm.tsx` | MODIFY | Same integration |
| `src/pages/DailyAssessmentForm.tsx` | MODIFY | Same integration |
| `src/components/admin/DataRecoveryTool.tsx` | MODIFY | Add local backup recovery UI |
| `src/hooks/useEmergencySave.tsx` | MODIFY | Trigger snapshot on emergency save |

## Security

- No API keys or secrets are involved in any localStorage or IndexedDB operations
- Snapshots contain report data only (no auth tokens, no credentials)
- Recovery tool is gated behind existing super admin checks
- Desktop read-only guard is a UI-level soft lock, not a security boundary

## Risk Assessment

- **localStorage size**: Capped at ~4MB with LRU eviction of synced-only snapshots. A typical report snapshot is 2-10KB, allowing 400+ reports.
- **IndexedDB version upgrade**: Bumping from v6 to v7 runs the upgrade handler which is additive-only (new store, no destructive changes).
- **Performance**: Snapshot writes are fire-and-forget after successful IndexedDB save. No impact on save latency.
- **Backward compatibility**: Existing data in IndexedDB v6 is preserved during upgrade. The backup store simply doesn't exist yet for older data.

