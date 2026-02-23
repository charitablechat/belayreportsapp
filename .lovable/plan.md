

## Fully Disable Timer (Keep Code for Future Reactivation)

### What Changes

**1. Disable the timer hook in all 3 report forms**

In `InspectionForm.tsx`, `TrainingForm.tsx`, and `DailyAssessmentForm.tsx`:
- Set `enabled: false` on the `useActiveTimer` hook call (replacing the current condition). This stops all background tracking -- no intervals, no event listeners, no idle timers.
- Comment out the `<ActiveTimerDisplay />` JSX block (wrap in `{/* DISABLED */}`) so it is not rendered but the code remains.
- Comment out the `active_duration_seconds: getElapsedSeconds()` line in the save object so existing saved values are not overwritten. Add a note like `// DISABLED: active_duration_seconds`.

**2. Grey out the Avg Completion Time card on the Admin dashboard**

In `SuperAdminDashboard.tsx`:
- Wrap the "Avg Completion Time" `StatCard` (lines 706-746) in a `<div className="opacity-40 pointer-events-none select-none">`. This visually greys it out, blocks interaction, and keeps it in the layout.
- All queries and logic behind it remain untouched.

### What Is Preserved (Untouched)
- `useActiveTimer` hook file (`src/hooks/useActiveTimer.tsx`)
- `ActiveTimerDisplay` component file (`src/components/ActiveTimerDisplay.tsx`)
- All imports in the form files (just the usage is disabled)
- All admin dashboard queries and calculation logic
- The `active_duration_seconds` column in the database

### Re-enabling Later
To turn the timer back on: restore the original `enabled` condition, uncomment the display and save lines, and remove the wrapper div from the admin card.
