

## Fix: Tab Counts Should Show Total Reports, Not Sliced Subset

The tab headers (e.g., "Inspections (11)") currently display the count of the sliced array (max 9 in "Recent" view) instead of the true total.

### Changes

**1. `src/pages/Dashboard.tsx`** — Pass full counts as new props:
```tsx
<DashboardReportsSection
  inspections={baseInspections}
  trainings={baseTrainings}
  dailyAssessments={baseDailyAssessments}
  totalInspections={inspections.length}
  totalTrainings={trainings.length}
  totalDailyAssessments={dailyAssessments.length}
  ...
/>
```

**2. `src/components/dashboard/DashboardReportsSection.tsx`**:
- Add 3 new optional props: `totalInspections`, `totalTrainings`, `totalDailyAssessments`
- In tab triggers, use `totalInspections ?? inspections.length` instead of `inspections.length` (same for the other two)

This way the tabs always show the full database count while the card grid still respects the 9-report "Recent" slice.

