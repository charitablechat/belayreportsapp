

# Sync Engine Audit: Remaining Gaps Found

## Summary

After the recent fixes (Bugs 1-7), the **main thread sync engine is solid**. However, the Service Worker still has one critical data-reading bug, and there is a significant RLS gap for admin access to child tables. The fuzzy search and restore hydration logic are working correctly.

---

## Bug 8 (CRITICAL): SW `getAllRelatedData` uses wrong index for trainings and assessments

**File:** `public/sw-sync.js`, line 141

The helper function hardcodes `store.index('by-inspection')` for ALL stores:

```js
function getAllRelatedData(db, storeName, inspectionId) {
  const index = store.index('by-inspection'); // WRONG for trainings & assessments
}
```

But IndexedDB stores use different index names:
- Inspection child stores: `'by-inspection'` (correct)
- Training child stores: `'by-training'` (line 736 of offline-storage.ts)
- Daily assessment child stores: `'by-assessment'` (line 704)

**Impact:** Every training/assessment child data read in the SW throws a `NotFoundError` (caught by `.catch(() => [])`), returning empty arrays. The `suspicious_empty_guard` then blocks the sync. The SW **cannot sync any training or daily assessment child data** — it only works for inspections.

**Fix:** Replace the single `getAllRelatedData` with a version that accepts the index name as a parameter, or create separate helpers per type:

```js
function getAllRelatedData(db, storeName, parentId, indexName) {
  indexName = indexName || 'by-inspection'; // backward compatible
  const index = store.index(indexName);
  ...
}
```

Then update callers:
- Training calls (lines 538-543): pass `'by-training'`
- Assessment calls (lines 666-671): pass `'by-assessment'`

---

## Bug 9 (HIGH): Admin child table RLS gap

The recent migration added `is_admin_or_above()` SELECT policies to the three **parent** tables (inspections, trainings, daily_assessments). But all **child** tables still only allow access for `super_admin` + owner:

- `inspection_systems`, `inspection_ziplines`, `inspection_equipment`, `inspection_standards`, `inspection_summary`, `inspection_photos`
- `training_delivery_approaches`, `training_operating_systems`, `training_immediate_attention`, `training_verifiable_items`, `training_systems_in_place`, `training_summary`, `training_photos`
- `daily_assessment_beginning_of_day`, `daily_assessment_end_of_day`, `daily_assessment_environment_checks`, `daily_assessment_equipment_checks`, `daily_assessment_structure_checks`, `daily_assessment_operating_systems`, `daily_assessment_photos`

**Impact:** An admin (non-super) who restores or opens someone else's report can see the parent row on the dashboard, but when they open the form, all child data (systems, equipment, checks) is invisible. Saves and completions also fail because INSERT/UPDATE on child tables is blocked by RLS.

**Fix:** Add `is_admin_or_above()` policies for SELECT, INSERT, UPDATE, DELETE on all child tables listed above. This aligns child access with parent access.

---

## Bug 10 (LOW): SW `getAllRelatedData` parameter naming is misleading

The third parameter is named `inspectionId` but it's used for training and assessment IDs too. This is cosmetic but makes the code harder to audit.

**Fix:** Rename to `parentId` when fixing Bug 8.

---

## No Issues Found In

- **Main thread sync** (`atomic-sync-manager.ts`): All 3 report types sync correctly after recent fixes
- **`getUnsynced*` functions** (`offline-storage.ts`): The `getAll()` + filter approach is working
- **Fuzzy search** (`DashboardReportsSection.tsx`): `normalizeForSearch`, `isCloseSubstring`, and `editDistance1` are correct — "ariel" matches "airiel"
- **Restore hydration** (`Dashboard.tsx`): `sessionStorage` marker + targeted fetch path is intact
- **`useAutoSync`**: Sequential sync with proper debounce, timeout, circuit breaker all correct
- **Photo sync** (`sync-manager.ts`): Uses per-photo metadata correctly

---

## Plan

### Step 1: Fix SW `getAllRelatedData` index name (Bug 8)

**File:** `public/sw-sync.js`

Add `indexName` parameter to `getAllRelatedData`. Update all training callers to pass `'by-training'` and assessment callers to pass `'by-assessment'`.

### Step 2: Add admin RLS policies for child tables (Bug 9)

**New migration**

Add `is_admin_or_above()` SELECT + INSERT + UPDATE + DELETE policies for all 20 child tables. This is a single SQL migration with 20 policy statements.

### Files to change

| File | Change |
|------|--------|
| `public/sw-sync.js` | Fix `getAllRelatedData` to accept index name parameter |
| New migration | Add admin RLS policies for all child tables |

