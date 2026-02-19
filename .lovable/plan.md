

# Data Loss Audit: Remaining Findings

After a comprehensive review of the sync, persistence, offline storage, dashboard caching, emergency save, and service worker code, the system is already heavily hardened. Three remaining low-severity vectors were identified.

---

## Finding 1: Service Worker Only Syncs Inspections (Not Trainings or Daily Assessments)

**Risk**: LOW -- background sync via the Service Worker (`sw-sync.js`) only handles inspections and photos. If the browser kills the main thread before `useAutoSync` processes trainings or daily assessments, those records will not sync until the user reopens the app.

**Where**: `public/sw-sync.js` -- the `sync` event listener only handles `inspection-sync` and `photo-sync` tags. There is no `training-sync` or `assessment-sync` handler.

**Fix**: Add `syncTrainingsAtomic()` and `syncDailyAssessmentsAtomic()` functions to `sw-sync.js` mirroring the existing `syncInspectionsAtomic()` pattern, and register new sync event tags for them.

---

## Finding 2: Orphan Cleanup Can Delete Records Hidden by RLS Pagination

**Risk**: LOW -- The Dashboard orphan cleanup compares local IndexedDB records against server results. However, Supabase has a default 1000-row query limit. If a super admin has more than 1000 active inspections/trainings/assessments, server results will be truncated. Local records beyond the 1000-row boundary will appear as "orphans" and be deleted from IndexedDB.

**Where**: `src/pages/Dashboard.tsx` lines ~396-451, ~548-600, ~696-750 -- the Supabase queries do not specify a `.limit()` or paginate, so they default to 1000 rows.

**Fix**: Add `.limit(10000)` to all three dashboard Supabase queries (inspections, trainings, daily assessments) to ensure the orphan cleanup comparison set is complete. This is a one-line change per query.

---

## Finding 3: `withTimeout` Silently Returns Empty Fallback on IndexedDB Timeout (Already Mitigated)

**Risk**: INFORMATIONAL -- The `withTimeout` wrapper in `offline-storage.ts` resolves with `fallbackValue` (usually `[]` or `null`) on timeout, rather than rejecting. For **read** operations this is safe (callers handle empty gracefully). For **write** operations, the `withIndexedDBErrorBoundary` wrapper returns `undefined` on timeout, and callers treat `undefined` returns as no-ops. Console warnings already fire.

No code change needed -- this is documented for awareness only. The 10x timeout warnings in the console logs confirm this is happening on the user's device and the system recovers correctly on the next cycle.

---

## What Was NOT Found (Already Protected)

These potential vectors were investigated and confirmed to be already hardened:

- **Empty array overwrite**: Blocked by `data.length === 0 && !options?.allowEmpty` guards in all save functions
- **Server overwrites unsynced local data**: Protected by `shouldPreserveLocalRecord` in Dashboard caching
- **Sync marks parent as synced before children commit**: Deferred `synced_at` pattern in both `atomic-sync-manager.ts` and `sw-sync.js`
- **Stale server deleting rich local data**: `empty_local_guard` in `atomic-sync-manager.ts` blocks sync when server has children but local is empty
- **Photo loss on IndexedDB eviction**: localStorage receipts and WAL backups capture metadata
- **Emergency save gap (tab close before debounce)**: `useEmergencySave` covers `visibilitychange` and `pagehide` with localStorage snapshot
- **Circuit breaker swallowing QuotaExceededError**: Already fixed in previous change
- **Orphan cleanup during active sync**: `isSyncInProgress()` guard + 60s/5min recency windows
- **Transaction rollback on partial sync failure**: `transaction-manager.ts` rolls back in reverse order
- **Delete operations on report tables**: Blocked by `REPORT_TABLE_BLOCKLIST` in transaction manager
- **Soft-deleted records reappearing**: `deleted_at IS NULL` filter on all dashboard queries and IndexedDB getters

---

## Implementation Plan

### File 1: `public/sw-sync.js`

Add two new sync functions mirroring `syncInspectionsAtomic()`:

1. `syncTrainings()` -- reads from IndexedDB `trainings` store, validates, upserts to server via fetch, aligns timestamps
2. `syncDailyAssessments()` -- reads from IndexedDB `daily_assessments` store with its child stores, validates, upserts, aligns timestamps
3. Register `training-sync` and `assessment-sync` tags in the `sync` event listener

### File 2: `src/pages/Dashboard.tsx`

Add `.limit(10000)` to the three Supabase queries:
- Line ~333: inspections query
- Line ~491: trainings query  
- Line ~640: daily assessments query

### File 3: `src/lib/background-sync.ts`

Add `registerTrainingSync()` and `registerAssessmentSync()` functions to register the new SW sync tags when trainings/assessments are saved offline.

---

## Technical Notes

- Finding 1 is the most actionable -- it closes the gap where the SW background sync cannot recover training/assessment data if the app is killed
- Finding 2 is unlikely to affect current users (would need 1000+ active reports) but is a one-line fix
- All changes maintain the existing upsert-only, deferred-synced_at, empty-array-guarded patterns
- No database migrations required
- No RLS policy changes required

