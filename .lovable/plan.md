

# Fix: Future Date Persistence Across Report Forms

## Root Cause

The training form's `submission_date` auto-population `useEffect` (TrainingForm.tsx:343-365) fires whenever `summary?.id` changes. When server data replaces the summary object via `setSummary(summaryResult)` at line 549, React sees a new `summary.id` reference change (even if the UUID is the same), triggering the effect. If the server-side `submission_date` is `null` (not yet synced), the effect overwrites the user's future date with `new Date()`.

The inspection and daily assessment date pickers themselves are correctly wired — their state flows through `handleHeaderUpdate` → debounced save → IndexedDB → sync. The `parseLocalDate` utility is timezone-safe. No issue found in those components.

## Affected Components

| Component | Field | Issue |
|-----------|-------|-------|
| `TrainingForm.tsx` | `submission_date` | Auto-populate effect re-fires after server hydration, resetting to today |
| `TrainingSummarySection.tsx` | `submission_date` | No issue — correctly displays and saves |
| `InspectionHeader.tsx` | `inspection_date` | No issue — hydration respects local-first |
| `SummarySection.tsx` | `next_inspection_date` | No issue — correctly persisted |
| `DailyAssessmentHeader.tsx` | `assessment_date` | No issue — correctly persisted |

## Fix (Single Change)

**File**: `src/pages/TrainingForm.tsx`, lines 343-365

**Current** (buggy):
```typescript
useEffect(() => {
  if (!summary || isLoading || !inspectorProfile) return;
  const updates: any = {};
  if (!summary.person_submitting) {
    // ... auto-populate name
  }
  if (!summary.submission_date) {
    updates.submission_date = format(new Date(), 'yyyy-MM-dd');
  }
  if (Object.keys(updates).length > 0) {
    isInternalUpdateRef.current = true;
    setSummary({ ...summary, ...updates });
  }
}, [summary?.id, isLoading, inspectorProfile]);
```

**Fixed**: Add a guard that only auto-populates on **first mount** (not on subsequent re-renders caused by server hydration). Use a ref to track whether the initial auto-populate has already run.

1. Add a ref: `const summaryAutoPopulatedRef = useRef(false);`
2. Guard the effect: skip if `summaryAutoPopulatedRef.current` is already `true`
3. Set the ref to `true` after first auto-populate runs
4. Reset the ref in cleanup (not needed since it's per-mount)

This ensures the auto-populate only fires once per form session, preventing server hydration from triggering a date reset.

## Scope

- **1 file changed**: `src/pages/TrainingForm.tsx`
- **No database changes**
- **No new dependencies**
- **No impact on comment handling, report generation, or sync logic**

