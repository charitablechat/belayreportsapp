

# Comprehensive No-Data-Loss Plan

## Audit Summary

After tracing all write operations, sync paths, and navigation guards across all three report types (Inspections, Trainings, Daily Assessments), the audit found **2 confirmed vulnerabilities** and validated **9 existing safeguards** as solid.

## Confirmed Vulnerabilities

### 1. TrainingForm: Navigation guard disabled on unlocked completed reports
**File:** `src/pages/TrainingForm.tsx`, line 147
**Risk:** When a user unlocks a completed training for editing and navigates away before the 1.5s auto-save debounce fires, edits are silently discarded -- no warning dialog, no save-before-leave.
**Fix:** Apply the same `completionLockOverridden` condition already fixed in InspectionForm.

### 2. DailyAssessmentForm: Identical vulnerability
**File:** `src/pages/DailyAssessmentForm.tsx`, line 142
**Risk:** Same as above -- edits to unlocked completed assessments are silently lost on navigation.
**Fix:** Same pattern -- add `|| completionLockOverridden` to the guard condition.

## Code Hygiene: Consolidate isLocalDataNewer usage

TrainingForm (lines 316-320) and DailyAssessmentForm (lines 346-350) implement the `isLocalDataNewer` logic inline rather than using the shared utility from `src/lib/local-data-guards.ts`. While functionally equivalent, this creates maintenance risk -- if the logic is updated in one place but not the others.

**Fix:** Replace the inline logic in both forms with the shared `isLocalDataNewer` import.

## Existing Safeguards Verified (No Changes Needed)

| Layer | Guard | Status |
|-------|-------|--------|
| IndexedDB | Empty-array save guard (blocks overwrite with []) | All 3 report types |
| IndexedDB | Clear restricted to temp- IDs only | All 3 report types |
| IndexedDB | Circuit breaker (fails fast after 3 failures) | Global |
| Transaction Manager | REPORT_TABLE_BLOCKLIST (28 tables) | Active |
| Atomic Sync | Deferred synced_at marking (only set after all children commit) | All 3 types |
| Atomic Sync | Empty local guard (blocks sync when server has data but local is empty) | Inspections |
| Atomic Sync | Soft-delete detection via RPC (cleans up orphaned local copies) | All 3 types |
| Form Loading | Local-data-newer check (prevents server overwrite of unsynced edits) | All 3 forms |
| Service Worker | Upsert-only sync with empty-array guards | Active |

## Implementation Details

### Fix 1: TrainingForm.tsx (line 147)

**Before:**
```typescript
hasUnsavedChanges: hasUnsavedChanges && training?.status !== 'completed',
```

**After:**
```typescript
hasUnsavedChanges: hasUnsavedChanges && (training?.status !== 'completed' || completionLockOverridden),
```

### Fix 2: DailyAssessmentForm.tsx (line 142)

**Before:**
```typescript
hasUnsavedChanges: hasUnsavedChanges && assessment?.status !== 'completed',
```

**After:**
```typescript
hasUnsavedChanges: hasUnsavedChanges && (assessment?.status !== 'completed' || completionLockOverridden),
```

### Fix 3: TrainingForm.tsx -- Use shared isLocalDataNewer utility (lines 316-320)

**Before:**
```typescript
const localIsNewer = offlineTraining && (
  !offlineTraining.synced_at ||
  (offlineTraining.updated_at && trainingData?.updated_at &&
   new Date(offlineTraining.updated_at) > new Date(trainingData.updated_at))
);
```

**After:**
```typescript
import { isLocalDataNewer } from "@/lib/local-data-guards";
// ...
const localIsNewer = isLocalDataNewer(offlineTraining, trainingData);
```

### Fix 4: DailyAssessmentForm.tsx -- Same consolidation (lines 346-350)

**Before:**
```typescript
const localIsNewer = offlineAssessment && (
  !offlineAssessment.synced_at ||
  (offlineAssessment.updated_at && assessmentData?.updated_at &&
   new Date(offlineAssessment.updated_at) > new Date(assessmentData.updated_at))
);
```

**After:**
```typescript
import { isLocalDataNewer } from "@/lib/local-data-guards";
// ...
const localIsNewer = isLocalDataNewer(offlineAssessment, assessmentData);
```

## Files Changed

1. `src/pages/TrainingForm.tsx` -- 2 changes (navigation guard fix + isLocalDataNewer consolidation)
2. `src/pages/DailyAssessmentForm.tsx` -- 2 changes (navigation guard fix + isLocalDataNewer consolidation)

## What This Does NOT Change

- No database migrations or schema changes
- No changes to IndexedDB structure or offline-storage.ts
- No changes to atomic-sync-manager.ts or transaction-manager.ts
- No changes to service worker sync logic
- No new dependencies

