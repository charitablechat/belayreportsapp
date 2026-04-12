

# Remaining Gaps Found

## Issue 1: Tab counts use global `dataValidated` — shows `…` unnecessarily (P1)

**Location**: `Dashboard.tsx` lines 1562-1564

```typescript
totalInspections={dataValidated ? inspections.length : undefined}
```

`dataValidated = inspectionsValidated && trainingsValidated && dailyValidated` — this is an AND of all three. So if inspections load instantly but daily assessments are slow, the Inspections tab still shows `…` instead of the real count. Each tab should use its own validation flag.

**Fix**: Pass per-dataset validation flags instead of the global AND:

```typescript
totalInspections={inspectionsValidated ? inspections.length : undefined}
totalTrainings={trainingsValidated ? trainings.length : undefined}
totalDailyAssessments={dailyValidated ? dailyAssessments.length : undefined}
```

Also update the `dataValidated` prop passed to `DashboardReportsSection` to be per-tab aware. The stats bar should use the active tab's validation state, not all three ANDed.

## Issue 2: Overdue stat computed from sliced data (P2)

**Location**: `DashboardReportsSection.tsx` lines 253-263

The `statsData` memo correctly uses `allInspections` for total/drafts/completed counts, but `overdue` is `criticalCount + warningCount` — which comes from `useDashboardFilters(currentReports, ...)`. In "Recent 9" mode, `currentReports` is sliced to 9 items, so the overdue count only reflects the visible slice, not the full dataset.

**Fix**: Compute overdue from `fullData` directly instead of relying on the filter hook's counts. Apply the same date-based overdue logic inline:

```typescript
const overdue = fullData.filter(r => {
  if (r.status === 'completed') return false;
  const dateField = /* pick correct date field per tab */;
  const daysSince = dateField ? differenceInDays(new Date(), new Date(dateField)) : 0;
  return daysSince > 30; // or whatever the existing threshold is
}).length;
```

This requires checking what `tierOf` logic `useDashboardFilters` uses for critical/warning classification, then replicating it for the full dataset.

## Issue 3: Unused `bypassAndProceed` destructuring (P3)

**Location**: All three forms destructure `bypassAndProceed` from `useUnsavedChanges` but never use it (the exit flow now uses direct `navigate('/dashboard')` calls).

**Fix**: Remove `bypassAndProceed` from the destructuring in `InspectionForm.tsx`, `TrainingForm.tsx`, and `DailyAssessmentForm.tsx`.

---

## Files to update

1. **`src/pages/Dashboard.tsx`** — Pass per-dataset validation flags instead of global AND for tab counts
2. **`src/components/dashboard/DashboardReportsSection.tsx`** — Accept per-tab validation; compute overdue from full data
3. **`src/pages/InspectionForm.tsx`** — Remove unused `bypassAndProceed`
4. **`src/pages/TrainingForm.tsx`** — Remove unused `bypassAndProceed`
5. **`src/pages/DailyAssessmentForm.tsx`** — Remove unused `bypassAndProceed`

## Summary

The previous rounds successfully fixed the critical dashboard zeros and stale state bugs. These three remaining issues are lower severity — the first causes unnecessary `…` placeholders on already-loaded tabs, the second miscounts overdue in "Recent" mode, and the third is dead code cleanup.

