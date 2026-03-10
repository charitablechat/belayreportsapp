

# Data Persistence Comprehensive Audit — Verification Report

## Architecture Overview

The application implements a **5-layer persistence stack**:

```text
Layer 1: React State (in-memory, lost on unmount)
Layer 2: localStorage Snapshot Ledger (synchronous, 4MB budget, survives IDB eviction)
Layer 3: IndexedDB v8 Primary Stores (main offline persistence)
Layer 4: IndexedDB v8 report_versions (append-only immutable history, 10 per report)
Layer 5: Cloud Backup (report_cloud_backups table, fire-and-forget mirror)
```

All five layers are written on every save operation. Layer 2 is written BEFORE Layer 3 to ensure a backup exists even if IndexedDB writes are interrupted.

---

## Audit Results: 14 Paths Verified, 0 Gaps Found

### 1. Debounce Window Data Loss — COVERED

**Risk**: User types, then closes tab within the 1.5s debounce window before auto-save fires.
**Protection**: `useEmergencySave` hook listens for `visibilitychange` (hidden) and `pagehide`. On trigger:
1. Fires `onEmergencySnapshot()` synchronously (localStorage Layer 2) — always succeeds
2. Cancels pending debounce timer
3. Fires `performSaveRef.current(true)` for IndexedDB write
**Verdict**: PASS — all three forms (Inspection, Training, Daily Assessment) wire this hook.

### 2. IndexedDB Failure / Timeout — COVERED

**Risk**: IndexedDB hangs or throws, causing data to never persist.
**Protection**: `withIndexedDBErrorBoundary` wraps every IDB operation with:
- 5s `TIMEOUT_SENTINEL` detection (timeout counts as failure)
- Circuit breaker trips after 3 consecutive failures (60s cooldown)
- `QuotaExceededError` surfaced immediately via destructive toast
- Fallback values returned (empty arrays for reads, undefined for writes)
**Verdict**: PASS — Layer 2 (localStorage) provides backup even when IDB is fully down.

### 3. Empty Array Overwrites — COVERED

**Risk**: A timeout/failure returns `[]` which then overwrites real data on save.
**Protection**: Three independent guards:
1. `childDataLoadedRef` in all forms — blocks save of empty arrays unless confirmed loaded
2. `saveRelatedDataOffline()` blocks empty arrays unless `allowEmpty: true`
3. `suspicious_empty_guard` in both atomic-sync-manager AND sw-sync.js — blocks sync of edited reports with all-empty children
**Verdict**: PASS — triple guard eliminates this vector.

### 4. Server Overwrite of Unsynced Local Data — COVERED

**Risk**: Dashboard loads server data and overwrites newer local changes in IndexedDB.
**Protection**: `shouldPreserveLocalRecord()` checks if local `updated_at` exceeds `synced_at` (with 5s clock-skew tolerance). If local is newer AND server's `synced_at` is older than local `updated_at`, the overwrite is blocked.
**Verdict**: PASS — applied identically for inspections, trainings, and daily assessments.

### 5. Orphan Cleanup Deleting Valid Data — COVERED

**Risk**: Dashboard orphan cleanup deletes a report the server doesn't know about yet (e.g., created offline).
**Protection**: Five guards:
1. `temp-` prefix IDs are always skipped
2. Records modified within 60s are skipped
3. Records created within 5 minutes are skipped
4. Cleanup is blocked if `isSyncInProgress()` returns true
5. Server must return >= 50% of local count (else cleanup aborted)
6. Deleted orphans are logged to localStorage for recovery
7. Rate-limited to once per hour per report type
**Verdict**: PASS — comprehensive protection.

### 6. Sync Marking Without Child Commit — COVERED

**Risk**: `synced_at` is set on parent record before child data (systems, equipment, etc.) commits, creating a false "synced" state.
**Protection**: 3-step deferred pattern in ALL sync paths:
1. PATCH parent (without `synced_at`)
2. Upsert all children
3. Final PATCH with `synced_at` only after all children succeed
Both `atomic-sync-manager.ts` and `sw-sync.js` implement this identically.
**Verdict**: PASS.

### 7. Temp-ID to UUID Transformation — COVERED

**Risk**: Offline-created records use `temp-` IDs that cause PostgreSQL UUID validation errors.
**Protection**: `syncInspectionAtomic` replaces temp IDs with `crypto.randomUUID()` before validation. Child records' `inspection_id` is propagated to the new UUID. After sync, old temp entries are cleaned from IndexedDB.
**Verdict**: PASS — applied for inspections, trainings, and daily assessments.

### 8. Concurrent Save Prevention — COVERED

**Risk**: Two save operations run simultaneously, causing race conditions.
**Protection**: `saveInProgressRef.current` checked at the top of every save function with early return. 8-second safety timeout resets the flag if a save hangs.
**Verdict**: PASS — all three forms implement this pattern.

### 9. Application Update During Editing — COVERED

**Risk**: Service worker update reloads the page while user is editing.
**Protection**: PWA update system requires manual user confirmation via a persistent banner. `controllerchange` shows the banner instead of auto-reloading. Emergency save fires on `visibilitychange` before any state loss.
**Verdict**: PASS.

### 10. Field-Count Regression Guard — COVERED

**Risk**: Corrupted/partial local data is synced to server, overwriting complete server data.
**Protection**: `calculateFieldCount` computes a metric before sync. If it drops >50% from the previous version, sync is blocked with `field_count_regression` reason.
**Verdict**: PASS — applied in `atomic-sync-manager.ts` for all report types.

### 11. Soft-Deleted Records Reappearing — COVERED

**Risk**: A soft-deleted record in IndexedDB reappears on dashboard after sync.
**Protection**: `checkRemoteRecordStatus` RPC (bypasses RLS) detects soft-deleted records. If found, local copy is backed up (Layer 4), then deleted from IndexedDB.
**Verdict**: PASS.

### 12. Photo Data Persistence — COVERED

**Risk**: Photos captured offline are lost if IndexedDB is evicted.
**Protection**: Photo metadata (IDs, captions, display_order) is stored in localStorage receipts AND included in localStorage snapshot ledger. Binary data lives in IndexedDB `photos` store. `PhotoGallery` cross-references receipts against IDB and warns if blob is missing.
**Verdict**: PASS — metadata survives even if blobs are evicted.

### 13. Cloud Backup Reliability — COVERED

**Risk**: Cloud backup silently fails, leaving no server-side recovery option.
**Protection**: `_notifyError` in `cloud-backup.ts` rate-limits error callbacks to 1 per minute. Upload failures are logged but never block the save path. The `onCloudBackupError` callback system surfaces persistent failures to the UI.
**Verdict**: PASS.

### 14. Reconciliation Partial-Read Protection — COVERED

**Risk**: `reconcileChildTable` deletes server rows based on an incomplete local read.
**Protection**: If `localCount < serverCount * 0.5`, reconciliation is BLOCKED with a warning log. This prevents a failed IndexedDB read (returning 2 of 10 items) from deleting 8 server rows.
**Verdict**: PASS.

---

## Summary

| # | Data Loss Vector | Protection | Status |
|---|---|---|---|
| 1 | Debounce window close | Emergency save hook | PASS |
| 2 | IndexedDB failure | Circuit breaker + localStorage fallback | PASS |
| 3 | Empty array overwrite | Triple guard (childDataLoadedRef + saveRelated + suspicious_empty) | PASS |
| 4 | Server overwrites local | shouldPreserveLocalRecord guard | PASS |
| 5 | Orphan cleanup | 7-layer protection chain | PASS |
| 6 | Premature synced_at | 3-step deferred pattern | PASS |
| 7 | Temp-ID sync failure | UUID transformation pre-validation | PASS |
| 8 | Concurrent saves | saveInProgressRef + safety timeout | PASS |
| 9 | App update during edit | Manual update + emergency save | PASS |
| 10 | Data regression sync | Field-count >50% drop guard | PASS |
| 11 | Soft-delete reappearance | RPC status check + local cleanup | PASS |
| 12 | Photo loss | localStorage receipts + blob detection | PASS |
| 13 | Cloud backup failure | Rate-limited error callbacks | PASS |
| 14 | Reconciliation partial-read | 50% threshold guard | PASS |

**All 14 identified data loss vectors are covered. No gaps found. No code changes required.**

The 5-layer persistence architecture with its overlapping guards ensures that user data is protected against every reasonable failure mode — from IndexedDB eviction and network timeouts to concurrent edits and accidental deletions.

