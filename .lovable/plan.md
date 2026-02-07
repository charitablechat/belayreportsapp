

# Plan: Fix Deleted Reports Reappearing on Dashboard - v2.4.12

## Root Cause

Two sources cause deleted reports to reappear after refresh:

1. **Super Admin RLS Policy**: Regular users have `deleted_at IS NULL` in their RLS SELECT policies, so the database correctly hides deleted records for them. However, **super admins** have a separate policy (`Super admins can view deleted [table] for recovery`) that returns deleted records too. The dashboard queries don't filter these out, so deleted records reappear for super admins.

2. **Offline Storage (IndexedDB)**: The parallel loading pattern shows IndexedDB-cached data first. The offline storage functions (`getOfflineInspections`, `getOfflineTrainings`, `getOfflineDailyAssessments`) never filter out records with a `deleted_at` field set. So even after a soft delete removes the record from IndexedDB, if the record was re-cached from a network fetch (which for super admins includes deleted records), it reappears.

## Solution

### 1. Dashboard Supabase Queries - Filter out deleted records

Add `.is('deleted_at', null)` to all three dashboard queries (inspections, trainings, daily_assessments). This ensures that even for super admins (whose RLS allows seeing deleted records), the dashboard only shows active reports.

**File: `src/pages/Dashboard.tsx`**

- `loadInspections`: Add `.is('deleted_at', null)` to the Supabase query
- `loadTrainingReports`: Add `.is('deleted_at', null)` to the Supabase query  
- `loadDailyAssessments`: Add `.is('deleted_at', null)` to the Supabase query

### 2. Offline Storage - Filter out soft-deleted cached records

Add `deleted_at` filtering to the three getter functions so IndexedDB never surfaces deleted records.

**File: `src/lib/offline-storage.ts`**

- `getOfflineInspections`: Filter out records where `deleted_at` is set
- `getOfflineTrainings`: Filter out records where `deleted_at` is set (same pattern)
- `getOfflineDailyAssessments`: Filter out records where `deleted_at` is set (same pattern)

### 3. Version Bump

**File: `vite.config.ts`** - Bump to v2.4.12

## Files Changed

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Add `.is('deleted_at', null)` filter to all 3 Supabase queries |
| `src/lib/offline-storage.ts` | Filter out `deleted_at` records in all 3 getter functions |
| `vite.config.ts` | Version bump to v2.4.12 |

