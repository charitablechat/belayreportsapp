

# Robust Data Persistence + Local-First Protection for All Report Types - v2.4.17

## Problem

The "local-is-newer" guard that prevents server data from overwriting unsynced local changes was only added to **InspectionForm**. The same data-loss vulnerability still exists in **TrainingForm** and **DailyAssessmentForm** -- when opened online, server data silently replaces locally-entered data that hasn't been synced yet.

The dropdown menu order is already correct (Profile, Check for Updates, Contact Developer, Force Sync Now, Activity Log, then remaining items) -- no changes needed there.

## What's Already Solid (No Changes Needed)

- **Soft deletion**: All three report tables use `deleted_at`/`retention_until` with 60-day retention and pg_cron cleanup
- **Offline storage filtering**: All IndexedDB getters already filter `deleted_at` records
- **Dashboard queries**: All three Supabase queries already include `.is('deleted_at', null)`
- **InspectionForm**: Already has the `localIsNewer` guard (added in v2.4.16)
- **Dropdown menu order**: Already matches the requested priority

## Changes Required

### 1. TrainingForm - Add local-is-newer guard (src/pages/TrainingForm.tsx)

**Current behavior (lines 305-351):** When online, `trainingData` from the server unconditionally overwrites local state with `setTraining(trainingData)`, `setDeliveryApproaches(approachData)`, etc., and then saves server data back to IndexedDB -- erasing any unsynced local changes.

**Fix:** Before applying server data, compare timestamps. If the local training has never been synced (`!synced_at`) or has a newer `updated_at`, skip the server overwrite and preserve local state. Only update server metadata (like status).

```text
Logic inserted between lines 303 and 305:

  const localIsNewer = offlineTraining && (
    !offlineTraining.synced_at ||
    (offlineTraining.updated_at && trainingData?.updated_at &&
     new Date(offlineTraining.updated_at) > new Date(trainingData.updated_at))
  );

  if (localIsNewer) {
    // Preserve local state, only accept server metadata
    console.log('[TrainingForm] Local data is newer -- preserving local state');
    if (trainingData) {
      setTraining(prev => ({ ...prev, status: trainingData.status }));
      setInspectorId(trainingData.inspector_id);
    }
    // Skip all related data loading and IndexedDB cache overwrites
  } else {
    // Existing server-data-apply logic (current lines 305-351)
  }
```

### 2. DailyAssessmentForm - Add local-is-newer guard (src/pages/DailyAssessmentForm.tsx)

**Current behavior (lines 299-334):** Identical problem -- server data unconditionally overwrites local state.

**Fix:** Same pattern as above. If `offlineAssessment` is newer or unsynced, skip the server overwrite.

```text
Logic inserted between lines 297 and 299:

  const localIsNewer = offlineAssessment && (
    !offlineAssessment.synced_at ||
    (offlineAssessment.updated_at && assessmentData?.updated_at &&
     new Date(offlineAssessment.updated_at) > new Date(assessmentData.updated_at))
  );

  if (localIsNewer) {
    console.log('[DailyAssessmentForm] Local data is newer -- preserving local state');
    if (assessmentData) {
      setAssessment(prev => ({ ...prev, status: assessmentData.status }));
      setInspectorId(assessmentData.inspector_id);
    }
    // Skip related data loading and IndexedDB cache overwrites
  } else {
    // Existing server-data-apply logic (current lines 299-334)
  }
```

### 3. Version bump (vite.config.ts)

Bump to v2.4.17.

## Files Changed

| File | Change |
|------|--------|
| `src/pages/TrainingForm.tsx` | Add `localIsNewer` guard before server data overwrites local state |
| `src/pages/DailyAssessmentForm.tsx` | Add `localIsNewer` guard before server data overwrites local state |
| `vite.config.ts` | Bump to v2.4.17 |

## What This Does NOT Change

- No changes to save/sync logic -- only the **load** path is affected
- No changes to soft deletion (already implemented correctly)
- No changes to offline storage filtering (already filters `deleted_at`)
- No changes to dropdown menu (already in correct order)
- No changes to InspectionForm (already fixed in v2.4.16)

