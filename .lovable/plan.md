

# Mobile-First Bulletproof Data Persistence: Append-Only Versioning + Sync Shield

## Overview

This plan adds three major capabilities on top of the existing zero-data-loss infrastructure:

1. **Append-Only Version History** in IndexedDB -- every save creates a new immutable snapshot instead of overwriting, keeping a recoverable trail of all edits
2. **Desktop Read-Only Sync Shield** -- server-side and client-side guards that prevent web/desktop sessions from overwriting mobile-origin data
3. **Retro-Tech Terminal UI** for data integrity status indicators (Matrix Green `#00FF41` on Deep Black `#0D0D0D`) with "Hard-Saved" toasts and a "Sync Shield" toggle

## What Already Exists (No Rework Needed)

The current system already has strong protections that this plan builds on top of, not replaces:

- IndexedDB as primary local store with circuit breaker, empty-array save guards, and temp-ID-only clear restrictions
- localStorage backup ledger (`local-backup-ledger.ts`) with LRU eviction of synced snapshots
- WAL backup store (`report_backups`) in IndexedDB v7
- Emergency save on `visibilitychange`/`pagehide` events
- Transaction Manager blocklist preventing server deletes on 28 report tables
- Atomic sync with deferred `synced_at` marking and empty-local-guard
- Orphan cleanup with threshold guards, rate limiting, and recovery logs

## Phase 1: Append-Only Version History in IndexedDB

### New Object Store: `report_versions` (IndexedDB v8)

Rather than overwriting the single record in `report_backups` on every save, we add a dedicated `report_versions` store that accumulates immutable snapshots.

**Schema:**
```
report_versions: {
  key: string (auto-generated UUID)
  value: {
    id: string,
    reportType: 'inspection' | 'training' | 'daily_assessment',
    reportId: string,
    versionNumber: number,
    timestamp: number,
    device: 'mobile' | 'desktop',
    parentData: Record<string, any>,
    childrenData: Record<string, any[]>,
    trigger: 'auto_save' | 'manual_save' | 'emergency_save' | 'pre_sync',
    fieldCount: number  // quick integrity check
  }
  indexes: {
    'by-report': reportId,
    'by-timestamp': timestamp,
    'by-report-version': [reportId, versionNumber]
  }
}
```

**Retention policy:** Keep the last 10 versions per report. Pruning happens asynchronously after a new version is saved -- never blocks the save path.

**File:** `src/lib/offline-storage.ts`
- Bump schema to v8
- Add `report_versions` object store in the upgrade handler
- New exported functions: `saveReportVersion()`, `getReportVersions()`, `getLatestVersion()`, `restoreFromVersion()`

### Integration Points

**File:** `src/lib/report-version-manager.ts` (NEW)
- `appendVersion(reportType, reportId, parentData, childData, trigger)` -- creates an immutable version entry
- `getVersionHistory(reportType, reportId)` -- lists all versions with metadata
- `restoreVersion(reportType, reportId, versionId)` -- restores a specific version to the active store
- Auto-increments `versionNumber` per report
- Calculates `fieldCount` (sum of non-empty fields across parent + children) for quick integrity comparison

**Files:** `src/pages/InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`
- After every successful `saveRelatedDataOffline` call, fire `appendVersion()` with trigger `'auto_save'` or `'manual_save'`
- In `useEmergencySave`, fire with trigger `'emergency_save'`
- Before sync in `atomic-sync-manager.ts`, fire with trigger `'pre_sync'`

## Phase 2: Desktop Sync Shield (One-Way Protection)

### Client-Side: Device Origin Tracking

**File:** `src/lib/offline-storage.ts`
- When saving inspection/training/assessment offline, stamp a `last_device_type: 'mobile' | 'desktop'` field on the record using `isMobile()`

**Files:** `src/pages/InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`
- On form load, check if the report's `last_device_type === 'mobile'` AND current device is desktop
- If so, show a **Sync Shield Banner** (Retro-Tech Terminal style) warning that edits from desktop are restricted
- User can override with an explicit "I understand -- enable editing" confirmation
- State tracked via `desktopEditOverride` ref (not persisted -- resets on reload for safety)

### Server-Side: Empty-Payload Rejection in Atomic Sync

**File:** `src/lib/atomic-sync-manager.ts`
- Already has `empty_local_guard` that blocks sync when local is empty but server has data
- Add a new **field-count regression guard**: before syncing, compare `fieldCount` of local data vs. the last known `fieldCount` from the version history. If local field count dropped by more than 50%, block the sync and log a warning
- This catches the scenario where a desktop session loaded stale/partial data and attempts to push it to the server

### Sync Manager Enhancement

**File:** `src/lib/atomic-sync-manager.ts`
- In `syncInspectionAtomic()`, before building transaction steps, call `appendVersion()` with trigger `'pre_sync'` to snapshot the pre-sync state
- This means even if the sync overwrites something, the pre-sync version is recoverable from `report_versions`

## Phase 3: Retro-Tech Terminal UI Components

### Data Integrity Badge Component

**File:** `src/components/ui/data-integrity-badge.tsx` (NEW)

A compact status indicator using the Matrix Green aesthetic:
- **HARD-SAVED**: Green glow -- data committed to IndexedDB + localStorage backup
- **PENDING**: Amber pulse -- data in React state, debounce timer active
- **SYNCED**: Cyan -- data confirmed on server
- **SHIELD ACTIVE**: Green border -- desktop sync protection enabled

Style: `bg-[#0D0D0D] text-[#00FF41] font-mono text-xs border border-[#00FF41]/30 shadow-[0_0_8px_rgba(0,255,65,0.3)]`

### Hard-Saved Toast Notification

**File:** `src/lib/toast-helpers.ts` (MODIFY)
- Add a `showHardSavedToast()` function that displays a brief toast with the Retro-Tech Terminal style
- Shows version number and field count for the saved snapshot
- Only shown on manual saves (not on every auto-save to avoid noise)

### Sync Shield Toggle

**Files:** `src/pages/InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`
- Add a small toggle icon in the form header (shield icon from Lucide)
- When active (desktop viewing mobile-origin report), shows a green-bordered shield with "SYNC SHIELD" label
- Clicking the shield shows version history in a slide-out panel

### Version History Panel

**File:** `src/components/admin/VersionHistoryPanel.tsx` (NEW)
- Slide-out panel showing all immutable versions for the current report
- Each entry shows: version number, timestamp, device type, trigger type, field count
- "Restore" button per version -- writes that version's data back to the active IndexedDB stores
- Retro-Tech Terminal aesthetic: monospace, scanline overlay, green-on-black

### Recovery Dashboard Extension

**File:** `src/components/admin/DataRecoveryTool.tsx` (MODIFY)
- Add a "Version History" tab alongside the existing "Local Backups" tab
- Lists all reports with version counts
- Drill into any report to see full version timeline

## Files to Create/Modify Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/report-version-manager.ts` | CREATE | Append-only version history logic |
| `src/components/ui/data-integrity-badge.tsx` | CREATE | Retro-Tech Terminal status badge |
| `src/components/admin/VersionHistoryPanel.tsx` | CREATE | Version history slide-out panel |
| `src/lib/offline-storage.ts` | MODIFY | v8 schema with report_versions store, device stamp |
| `src/lib/atomic-sync-manager.ts` | MODIFY | Pre-sync version snapshot, field-count regression guard |
| `src/pages/InspectionForm.tsx` | MODIFY | Version saves, sync shield banner, badge integration |
| `src/pages/TrainingForm.tsx` | MODIFY | Same as InspectionForm |
| `src/pages/DailyAssessmentForm.tsx` | MODIFY | Same as InspectionForm |
| `src/lib/toast-helpers.ts` | MODIFY | Hard-saved toast with terminal style |
| `src/components/admin/DataRecoveryTool.tsx` | MODIFY | Version History tab |
| `src/hooks/useEmergencySave.tsx` | MODIFY | Pass version trigger type |
| `src/index.css` | MODIFY | Add retro-terminal utility classes |

## Security

- No API keys or database credentials stored in frontend code
- All version data stays in client-side IndexedDB/localStorage only
- Desktop sync shield is a UI-level guard (soft lock with user override), not a security boundary
- Server-side RLS policies remain unchanged -- the field-count regression guard is an additional client-side safety net
- Console logs use truncated IDs (first 8 chars) only

## Risk Assessment

- **IndexedDB v8 upgrade**: Additive only (new store). Existing v7 data is fully preserved.
- **Version storage growth**: Capped at 10 versions per report. A typical version is 5-15KB, so 100 reports x 10 versions = ~10MB maximum, well within IndexedDB quotas.
- **Performance**: Version writes are fire-and-forget after the primary save completes. Pruning is async. Zero impact on save latency.
- **Backward compatibility**: Reports without version history simply show "No versions available" in the panel.

