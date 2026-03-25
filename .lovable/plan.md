

## Fix "View Full List" on Admin Stat Cards

### Problem
The **Training Reports** and **Daily Assessments** stat cards have no `onClick` handler, so the "View more details →" link in their hover/sheet popups does nothing. Only the Inspections card works, and even its list dialog rows aren't clickable to navigate to individual reports.

### Changes

**File: `src/pages/SuperAdminDashboard.tsx`**

1. **Add state variables** for the two missing list dialogs:
   - `isTrainingsListOpen` / `setIsTrainingsListOpen`
   - `isDailyListOpen` / `setIsDailyListOpen`
   - `trainingsPage` / `dailyPage` pagination state

2. **Add `onClick` handlers** to the Training Reports and Daily Assessments stat cards:
   - Training Reports: `onClick={() => setIsTrainingsListOpen(true)}`
   - Daily Assessments: `onClick={() => setIsDailyListOpen(true)}`

3. **Add two new Dialog components** (after the existing Inspections List Dialog), following the same pattern — paginated table with Organization, Location/Site, Status, Date columns

4. **Make all three list dialog rows clickable** — add `cursor-pointer` and `onClick={() => navigate('/inspection/{id}')}`  (and `/training/{id}`, `/daily-assessment/{id}` respectively) so clicking a row navigates to that report

### No other files need changes.

