
# Plan: Fix Data Disappearance Issue

## Problem Summary

Reports with user-entered data are being **incorrectly deleted** due to flawed empty report detection logic and race conditions. The core issues are:

1. **Missing User Interaction Tracking**: `InspectionForm.tsx` and `TrainingForm.tsx` do NOT track user interactions (via `hasUserInteracted`), unlike `DailyAssessmentForm.tsx`. This means the cleanup hook can run even when users have entered data.

2. **Race Condition with Stale Data**: When a user navigates away, the `cleanupEmptyReport` function runs in the `useEffect` cleanup callback. The `relatedData` refs may contain **stale or initial empty state** values instead of the actual loaded data.

3. **Flawed Empty Detection Logic**: The `isInspectionEmpty()` function in `report-utils.ts` checks if arrays have "meaningful data" using criteria that may miss legitimate user input. For example:
   - Systems require `name`, `comments`, OR `result !== 'pass'` - but a user could have just a system type selected
   - Standards with default values are considered "empty" even if explicitly reviewed

4. **Aggressive Cleanup on Unmount**: The cleanup runs on **every** navigation away from a draft report, even when data exists but hasn't fully synced to the refs.

---

## Solution: Disable Empty Report Cleanup Entirely

Given the requirement for **immediate, irreversible persistence** where data can ONLY be removed via manual user action, the safest approach is to **completely disable the automatic empty report cleanup mechanism**.

### Rationale

- Empty reports can be cleaned up manually by users or via a Super Admin data recovery tool
- The soft-delete pattern already allows 60-day recovery, so "empty" draft reports are not truly harmful
- False positives (deleting reports with data) are far more damaging than false negatives (keeping empty drafts)

---

## Implementation Details

### 1. Remove Empty Report Cleanup from All Forms

**Files to Modify:**
- `src/pages/InspectionForm.tsx`
- `src/pages/TrainingForm.tsx`
- `src/pages/DailyAssessmentForm.tsx`

**Changes:**
- Remove the `useEmptyReportCleanup` hook import and usage
- Remove the cleanup `useEffect` that calls `cleanupEmptyReport()` on unmount
- Keep all other data persistence logic intact

### 2. (Optional) Keep the Hook for Manual Cleanup Only

If desired, the `useEmptyReportCleanup` hook can be retained for potential future use (e.g., a "Delete Empty Draft" button on the dashboard) but will not be called automatically on navigation.

---

## Technical Changes

### InspectionForm.tsx
```diff
- import { useEmptyReportCleanup } from "@/hooks/useEmptyReportCleanup";

- // Empty report cleanup
- const { cleanupEmptyReport } = useEmptyReportCleanup({
-   type: 'inspection',
-   id,
-   status: inspection?.status,
-   data: inspection,
-   relatedData: {
-     systems,
-     ziplines,
-     equipment,
-     standards,
-     summary,
-   }
- });

- // Cleanup empty reports on unmount
- useEffect(() => {
-   return () => {
-     if (inspection?.status === 'draft') {
-       cleanupEmptyReport();
-     }
-   };
- }, [inspection?.status, cleanupEmptyReport]);
```

### TrainingForm.tsx
```diff
- import { useEmptyReportCleanup } from "@/hooks/useEmptyReportCleanup";

- // Empty report cleanup
- const { cleanupEmptyReport } = useEmptyReportCleanup({
-   type: 'training',
-   id,
-   status: training?.status,
-   data: training,
-   relatedData: {
-     deliveryApproaches,
-     operatingSystems,
-     immediateAttention,
-     verifiableItems,
-     systemsInPlace,
-     summary,
-   }
- });

- // Cleanup empty reports on unmount
- useEffect(() => {
-   return () => {
-     if (training?.status === 'draft') {
-       cleanupEmptyReport();
-     }
-   };
- }, [training?.status, cleanupEmptyReport]);
```

### DailyAssessmentForm.tsx
```diff
- import { useEmptyReportCleanup } from "@/hooks/useEmptyReportCleanup";

- // Track if user has interacted with the form - prevents cleanup of non-empty assessments
- const hasUserInteractedRef = useRef(false);

- // Empty report cleanup - uses refs to avoid stale closure issues
- const { cleanupEmptyReport } = useEmptyReportCleanup({
-   type: 'daily_assessment',
-   id,
-   status: assessment?.status,
-   data: assessment,
-   relatedData: {
-     beginningOfDay,
-     endOfDay,
-     operatingSystems,
-     equipmentChecks,
-     structureChecks,
-     environmentChecks,
-   },
-   hasUserInteracted: hasUserInteractedRef.current,
- });

- // Cleanup empty reports on unmount
- useEffect(() => {
-   return () => {
-     if (assessment?.status === 'draft') {
-       cleanupEmptyReport();
-     }
-   };
- }, [assessment?.status, cleanupEmptyReport]);
```

Also remove `hasUserInteractedRef.current = true;` from all handler functions in DailyAssessmentForm since it will no longer be needed.

---

## Outcome

After these changes:

| Scenario | Before | After |
|----------|--------|-------|
| User enters data, navigates away | Data may be deleted if refs are stale | Data is preserved |
| User creates new draft, navigates away immediately | Empty draft remains | Empty draft remains (can be cleaned manually) |
| Report with data during load phase | Data may be incorrectly flagged as empty | Data is preserved |
| Sync failure during navigation | Data could be lost | Data is preserved in IndexedDB |

---

## Alternative Considered (Not Recommended)

An alternative would be to fix the race conditions by:
1. Adding `hasUserInteracted` tracking to all forms
2. Adding a loading state check to prevent cleanup during data fetch
3. Improving the empty detection logic

However, this approach is complex and still has edge cases. The simpler, safer solution is to disable automatic cleanup entirely.
