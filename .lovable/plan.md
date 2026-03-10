

# Performance Audit Report

## Measured Metrics (Landing Page)

| Metric | Value | Rating |
|--------|-------|--------|
| First Contentful Paint | **6,084ms** | Poor (>3s) |
| DOM Content Loaded | **5,922ms** | Poor |
| Full Page Load | **6,151ms** | Poor |
| Script Duration | **287ms** | Acceptable |
| JS Heap Used | **35.5MB** | Moderate |
| Total Resources | **250 scripts** | High (dev mode) |

---

## Top 5 Bottlenecks

### 1. `InspectionForm.tsx` — Monolithic 2,866-line component (101KB transfer)

**Impact**: Slowest resource at **1,097ms** load time. This single file contains ALL form logic: loading, saving, validation, summary generation, report generation, completion, emergency save, version history, and the entire render tree.

**Specific problems**:
- `performSave()` (line 1242) runs `saveReportSnapshot()` synchronously BEFORE IndexedDB writes, which calls `estimateBackupStorageBytes()` — iterating ALL localStorage keys on every save
- `uploadSnapshotToCloud()` (line 143 of `local-backup-ledger.ts`) fires `supabase.auth.getUser()` on every save — a network round-trip even though the user is already authenticated
- Summary auto-regeneration effect (line 634) builds a full signature string from ALL equipment + systems + ziplines on every state change, running `.sort().join('|')` on potentially hundreds of items

**Recommendation**: 
- Replace `supabase.auth.getUser()` in `_doUpload` with `getUserWithCache()` (saves ~200ms network RT per save)
- Debounce `estimateBackupStorageBytes()` or cache the result for 5 seconds
- Extract `performSave` and `loadInspection` into custom hooks to enable code-splitting

### 2. `fetchCloudSnapshots()` — Fetches full `snapshot_data` JSONB column

**Impact**: Line 101 of `cloud-backup.ts` selects `snapshot_data` even though it's only used to extract `parent.organization` for the facility field. Each snapshot contains the entire report tree (parent + children + photo metadata). With 50 snapshots, this can be **megabytes** of unnecessary data transfer.

**Recommendation**: Remove `snapshot_data` from the select and add a computed/stored `facility` column, or use a database function to extract just the facility name server-side.

### 3. `GlobalAutocomplete` — Database fetch blocks popover display

**Impact**: When a user clicks an autocomplete field (e.g., Operating System element name), `fetchGlobalHistory()` (line 113) fires a database query. The popover shows a loading spinner until the query completes. On slow connections, items appear 500-2000ms after click — this is the "populated items fail to display" issue reported.

**Specific flow**: Click → `handleTriggerFocus` → `fetchGlobalHistory()` → `setIsLoading(true)` → network query → `setHistoryOptions()` → items visible. LocalStorage fallback loads immediately but may have stale/fewer items.

**Recommendation**: 
- Pre-fetch global history for all field types used on the current page in a single batched query when the form loads (not on focus)
- Show localStorage items immediately (already happens), but prioritize them visually while DB fetch runs in background
- Cache fetched results in a module-level Map so switching between items of the same field type is instant

### 4. Dashboard `loadInspections` — Sequential orphan cleanup blocking render

**Impact**: Lines 466-520 of `Dashboard.tsx` run orphan cleanup synchronously after network data arrives. For each local inspection not on the server, it performs an IndexedDB read (`getOfflineInspection`) and conditional delete. With many local records, this blocks the main thread.

**Recommendation**: Move orphan cleanup to a `requestIdleCallback` or `setTimeout(fn, 0)` to yield to the UI thread between iterations.

### 5. `DataRecoveryTool.tsx` — 66KB component loaded eagerly (1,421ms)

**Impact**: Second slowest resource. This admin-only component is imported by `UserDataRecoverySheet` which is rendered on the Dashboard. Even though the sheet is closed by default, the module is loaded and parsed at page load because there's no lazy loading.

**Recommendation**: Wrap `DataRecoveryTool` imports in `React.lazy()` so the 66KB module (which imports `offline-storage`, `local-backup-ledger`, and `date-fns` formatting) is only loaded when the recovery sheet opens.

---

## Actionable Summary

| Priority | Fix | Estimated Impact |
|----------|-----|-----------------|
| **P0** | Replace `getUser()` with `getUserWithCache()` in cloud-backup `_doUpload` | -200ms per save |
| **P0** | Pre-fetch `GlobalAutocomplete` history on form mount instead of on-focus | Eliminates "empty field" perception |
| **P1** | Remove `snapshot_data` from `fetchCloudSnapshots` select | -50-90% data transfer for recovery panel |
| **P1** | Lazy-load `DataRecoveryTool.tsx` | -1.4s initial parse, -66KB initial bundle |
| **P2** | Defer orphan cleanup with `requestIdleCallback` | Smoother dashboard after data loads |
| **P2** | Cache `estimateBackupStorageBytes` result | Reduces localStorage iteration per save |

No new logging or error handling is introduced. All recommendations optimize existing code paths.

