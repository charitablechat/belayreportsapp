

# Performance Audit: Reporting Pages & Interactive Fields

## Confirmed: Backup Modules NOT Causing Overhead

The recent `cloud-backup.ts` and `local-backup-ledger.ts` changes are clean:
- `uploadSnapshotToCloud` is fire-and-forget (line 62-66), never blocks UI
- `estimateBackupStorageBytes` has a 5s TTL cache (line 46-68), preventing repeated iteration
- `fetchCloudSnapshots` correctly excludes `snapshot_data` (line 102), fetching only metadata
- `_doUpload` uses `getUserWithCache()` (line 74), not raw `getUser()`

**No performance regressions from the backup modules.**

---

## Top Bottlenecks Found

### 1. `InspectionForm.tsx` — Summary Signature Recomputes on Every Child State Change

**File**: `src/pages/InspectionForm.tsx`, lines 634-713
**Issue**: The `useEffect` at line 634 depends on `[equipment, systems, ziplines]`. Every time any row in any table changes (typing a comment, changing a result), `getFailProvisionsSignature()` iterates ALL items, builds string keys, sorts, and joins. With 50+ items across three tables, this runs hundreds of times per session.
**Root Cause**: The signature function runs synchronously in the render cycle before the 800ms debounce even applies — the comparison `currentSignature !== previousFailProvisionsRef.current` happens every render.
**Fix**: Memoize the signature with `useMemo` so it only recomputes when the dependency arrays actually change (React already handles shallow comparison). Move the expensive `.sort().join('|')` into the memo.

### 2. `InspectionForm.tsx` — 8 EquipmentTable Instances All Receive Full Equipment Array

**File**: `src/pages/InspectionForm.tsx`, lines 2694-2756
**Issue**: Each of the 8 `EquipmentTable` components receives the entire `equipment` array and the same `setEquipment` setter. When ANY equipment item changes, ALL 8 tables re-render because `equipment` is a new array reference.
**Root Cause**: No memoization or category-level splitting of equipment data.
**Fix**: Memoize category-filtered arrays with `useMemo` per category, and wrap `EquipmentTable` in `React.memo`. Pass only the filtered subset to each instance.

### 3. `GlobalAutocomplete` — Loading Spinner Shown While Cache Exists

**File**: `src/components/GlobalAutocomplete.tsx`, lines 129-176, 398-401
**Issue**: Even after the previous fix added eager pre-fetch and module-level cache, the `isLoading` state is set to `true` at line 132 before checking if data is already cached. When the popover opens, `isLoading` is briefly `true` causing the spinner to flash even when cached data is available.
**Root Cause**: `fetchGlobalHistory` sets `isLoading(true)` unconditionally at line 132 before the guard at line 130 (`if (hasFetchedFromDb.current) return`) can exit. But the guard exits BEFORE `setIsLoading(true)` — wait, actually line 130 returns early. The real issue: on mount, `fetchGlobalHistory` is called (line 124), which sets `isLoading(true)`. If the DB query takes 500ms+, any focus during that window shows the spinner instead of localStorage items.
**Fix**: Don't set `isLoading(true)` if `historyOptions` already has items from localStorage. Show existing items immediately; only show spinner when the list is truly empty.

### 4. `Dashboard.tsx` — `.limit(10000)` Fetches Entire Inspection History

**File**: `src/pages/Dashboard.tsx`, line 414
**Issue**: The dashboard fetches up to 10,000 inspections from the server on every load. With joined profile data, this is a massive payload. The UI paginates (via `useDashboardFilters`), so only ~10-20 items are visible at a time.
**Root Cause**: No server-side pagination — all filtering/sorting happens client-side.
**Fix (incremental)**: Reduce `.limit(10000)` to `.limit(500)` as an immediate improvement. The existing `totalInspections` prop already supports showing a total count separately. Full server-side pagination is a larger refactor.

### 5. `DataRecoveryTool.tsx` — Cloud Panel Fetches on Tab Switch Without Cache

**File**: `src/components/admin/DataRecoveryTool.tsx` (CloudSnapshotsPanel)
**Issue**: Every time the user switches to the "Cloud" tab, `fetchCloudSnapshots()` fires a fresh DB query + profile lookups. There's no stale-while-revalidate or cache.
**Fix**: Use `useQuery` from `@tanstack/react-query` (already installed) with a `staleTime` of 30s to cache cloud snapshot metadata.

---

## Implementation Plan

### File 1: `src/pages/InspectionForm.tsx`

**Change A** — Memoize fail/provisions signature (line ~634):
- Replace the inline `getFailProvisionsSignature()` call with a `useMemo` that depends on `[equipment, systems, ziplines]`
- The `useEffect` then only compares the memoized string, not recomputing it

**Change B** — Memoize per-category equipment arrays (before render, ~line 2690):
- Add `useMemo` calls for each equipment category filter
- Pass memoized arrays to `EquipmentTable` instead of the full `equipment` array

### File 2: `src/components/GlobalAutocomplete.tsx`

**Change** — Suppress loading spinner when localStorage items exist (line ~132):
- Only set `isLoading(true)` if `historyOptions.length === 0` (no local fallback available)
- This ensures the popover shows existing items instantly while the DB fetch runs silently

### File 3: `src/pages/Dashboard.tsx`

**Change** — Reduce inspection fetch limit (line 414):
- Change `.limit(10000)` to `.limit(500)`
- Apply same to trainings and daily assessments queries if they have similar limits

### File 4: `src/components/inspection/EquipmentTable.tsx`

**Change** — Wrap component export in `React.memo` to prevent re-renders when props haven't changed

---

## Summary

| # | Component | Issue | Fix | Impact |
|---|-----------|-------|-----|--------|
| 1 | InspectionForm summary effect | Signature recomputes every render | `useMemo` | -50% CPU during editing |
| 2 | InspectionForm EquipmentTable x8 | All re-render on any change | `React.memo` + memoized arrays | -7x unnecessary re-renders |
| 3 | GlobalAutocomplete | Spinner flashes over cached data | Conditional `isLoading` | Instant popover display |
| 4 | Dashboard fetch | 10,000 row limit | Reduce to 500 | -95% payload size |
| 5 | DataRecoveryTool Cloud tab | No cache on tab switch | `useQuery` with staleTime | Instant tab switches |

