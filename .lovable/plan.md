

# Conditional Styling and Sorting for Report Cards by Age and Status

## Overview

Add age-based visual states (warning at 3+ days, critical at 5+ days) and completion-based styling (green border) to report cards. Critical reports are sorted to the top of the list. Completed reports revert to standard chronological sorting.

## Visual States

| State | Condition | Style |
|-------|-----------|-------|
| Default | Age <= 3 days, not completed | No change (existing card styling) |
| Warning | Age > 3 days, not completed | Yellow left border (border-l-4 border-yellow-400) |
| Critical | Age > 5 days, not completed | Red background (bg-red-50 border-red-300, dark: bg-red-950/30 border-red-700) |
| Completed | status === 'completed' | Green left border (border-l-4 border-green-500) |

"Age" is calculated from `created_at` to `new Date()`.

## Sorting Logic

Before the existing inspector-name sort, a primary sort is applied:

1. **Critical (>5 days, incomplete)** -- always first
2. **Warning (>3 days, incomplete)** -- after critical
3. **Default/Completed** -- retain existing chronological order

Within each tier, the existing sort (by `last_opened_at`/`created_at`/`assessment_date` or inspector name filter) is preserved.

Completed reports are excluded from age-based priority sorting regardless of their creation date.

## Files Changed

### 1. `src/components/dashboard/ReportCard.tsx`

- Import `differenceInDays` from `date-fns`
- Add a helper to compute the age state: `getAgeState(createdAt, status)` returning `'critical' | 'warning' | 'completed' | 'default'`
- Apply conditional className to the `<Card>` element based on the age state:
  - `'critical'`: `bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700`
  - `'warning'`: `border-l-4 border-yellow-400`
  - `'completed'`: `border-l-4 border-green-500`
  - `'default'`: no additional classes

### 2. `src/pages/Dashboard.tsx`

- Import `differenceInDays` from `date-fns`
- Extract a shared sort function `sortReportsWithAgePriority(reports, inspectorFilter, getNameFn)` that:
  1. Computes age tier for each report (critical > warning > default/completed)
  2. Sorts critical first, then warning, then the rest
  3. Within each tier, applies the existing inspector-name sort if active
  4. Otherwise preserves the server-provided chronological order
- Replace the three inline `.sort()` calls (inspections, trainings, dailyAssessments) with calls to this shared function

## Key Implementation Detail

The age calculation uses `created_at` (available on all three report types) rather than the report-specific date fields (`inspection_date`, `start_date`, `assessment_date`), because `created_at` represents when the report was actually started and is always present.

```text
Age State Logic:
  if status === 'completed' --> 'completed' (green border, normal sort position)
  else if differenceInDays(now, created_at) > 5 --> 'critical' (red bg, sort to top)
  else if differenceInDays(now, created_at) > 3 --> 'warning' (yellow border)
  else --> 'default'
```

## What Does NOT Change

- No database changes or new columns
- No changes to data fetching, offline storage, or sync logic
- No changes to the existing `getStatusBadge` prop or status badge rendering
- No changes to delete, click, or navigation handlers
- The existing "COMPLETED" watermark overlay remains unchanged
- The existing inspector-name filter (super admin) continues to work as a secondary sort

