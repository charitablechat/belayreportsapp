

# IndexedDB Storage Pressure — Audit & Mitigation Plan

## Current State

The app has **20+ IndexedDB object stores** holding reports, child tables, photos, operation queues, version history, and backup snapshots. Here's what exists today for storage management:

### What's Already Working
1. **Persistent storage request** — `requestPersistentStorage()` asks the browser not to evict data
2. **Photo blob nullification** — `markPhotoAsUploaded()` sets `blob = null` after successful upload, freeing the largest objects
3. **7-day photo blob pruning** — `pruneOldSyncedPhotoBlobs()` runs after each sync cycle, nullifying synced photo blobs older than 7 days
4. **24-hour cache cleanup** — `cleanupStaleCachedPhotos()` deletes re-cached remote photos older than 24 hours (runs hourly)
5. **Version history pruning** — `report_versions` caps at 10 snapshots per report
6. **Storage quota warning** — logs a warning when usage exceeds 80%
7. **Circuit breaker** — `withIndexedDBErrorBoundary` trips after 3 failures, falls back to localStorage

### What's Missing (Gaps)

| Gap | Risk | Description |
|-----|------|-------------|
| **No eviction of synced reports** | HIGH | Every report (inspection, training, assessment) + all child rows stay in IndexedDB forever, even after successful sync. A user with 500+ reports will accumulate megabytes of JSON. |
| **No eviction of synced report_backups** | HIGH | WAL backup snapshots grow unbounded. Each contains full report JSON. |
| **No proactive storage pressure response** | MEDIUM | The 80% warning only logs to console. No automated cleanup triggers. User gets no actionable UI. |
| **No storage dashboard for users** | LOW | Users cannot see how much space is used or take action. |
| **report_versions stores full parentData + childrenData** | MEDIUM | 10 versions × full JSON per report. For complex inspections this can be several MB per report. |
| **Photo metadata records never deleted** | LOW | Even after blob is nullified, the photo metadata row (with `blob: null`) remains forever. |

## Proposed Solution: Tiered Storage Eviction System

### 1. Create `src/lib/storage-pressure-manager.ts` (NEW FILE)

A centralized manager that:
- Checks `navigator.storage.estimate()` on each sync cycle
- Implements 3 pressure tiers with automatic cleanup:

```text
Tier 0 (< 60% used):  No action
Tier 1 (60-80% used): Evict synced report data older than 30 days
Tier 2 (80-90% used): Evict synced report data older than 7 days + prune version history to 3 per report
Tier 3 (> 90% used):  Aggressive — evict all synced data older than 24 hours + prune versions to 1 per report
```

**Key safety rule:** NEVER evict a record where `synced_at` is null or `synced_at < updated_at` (unsynced local changes). Only evict data that has been confirmed synced to the server.

**Eviction means:** Delete the parent record + all child rows (systems, equipment, ziplines, etc.) from IndexedDB. The data still lives on the server and will be re-fetched on demand when the user opens that report.

### 2. Add `evictSyncedReports()` to `src/lib/offline-storage.ts`

A function that:
- Iterates inspections, trainings, daily_assessments stores
- Identifies records where `synced_at >= updated_at` AND `synced_at` is older than the age threshold
- Deletes the parent + all associated child store entries (using the `by-inspection`/`by-training`/`by-assessment` indexes)
- Deletes associated `report_backups` entries
- Deletes photo metadata rows (blobs already nullified)
- Returns count of evicted reports for logging

### 3. Add `evictOldReportBackups()` to `src/lib/offline-storage.ts`

- Delete `report_backups` entries older than 14 days (these are WAL snapshots, not user-facing backups)
- Run after every sync cycle

### 4. Integrate into sync cycle (`useAutoSync.tsx`)

After the existing `pruneOldSyncedPhotoBlobs()` call, add:
```typescript
// Storage pressure management (non-blocking)
manageStoragePressure().catch(() => {});
```

### 5. Add storage indicator to Dashboard

A small badge/indicator in the dashboard header showing:
- Green: < 60% used
- Yellow: 60-80% used  
- Red: > 80% used
- Clicking opens a small panel showing usage breakdown and a "Clear synced cache" manual button

### 6. Reduce `report_versions` snapshot size

Instead of storing the full `parentData` + `childrenData` in every version, store only a delta (changed fields) for versions after the first. This is an optimization that can reduce version store size by ~80%.

**However**, this adds complexity to the restore path. A simpler alternative: reduce `MAX_VERSIONS_PER_REPORT` from 10 to 5, and exclude large HTML fields (`latest_report_html`) from version snapshots.

## Files Changed

1. **`src/lib/storage-pressure-manager.ts`** (NEW) — Tiered eviction logic + quota checking
2. **`src/lib/offline-storage.ts`** — Add `evictSyncedReports()`, `evictOldReportBackups()`, `evictPhotoMetadata()`
3. **`src/hooks/useAutoSync.tsx`** — Call `manageStoragePressure()` after sync
4. **`src/lib/report-version-manager.ts`** — Strip `latest_report_html` from snapshots, reduce max to 5
5. **`src/components/dashboard/DashboardStatsBar.tsx`** — Add storage usage indicator
6. **`src/App.tsx`** — Run initial storage pressure check on mount

## Safety Guarantees

- **Never evict unsynced data** — only records with `synced_at >= updated_at`
- **Never evict the currently open report** — check against current route
- **Re-fetch on demand** — when a user opens an evicted report, the form already fetches from the server as primary source
- **Graceful degradation** — if `navigator.storage.estimate()` is unavailable, fall back to time-based eviction only (30-day default)

