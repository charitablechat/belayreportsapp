
Fix the Invoiced tab count so it always reflects the full set of invoiced reports, not just the currently displayed “Recent Reports” slice.

What I found
- The data is there: the backend already has 1 row in `invoiced_reports`, linked to the Southwest Airlines inspection.
- The zero is a counting bug in the dashboard UI.
- `src/pages/Dashboard.tsx` defaults to `reportSection = "recent"`.
- When the active tab is not `invoiced`, it passes only the recent top 9 reports into `DashboardReportsSection`.
- `src/components/dashboard/DashboardReportsSection.tsx` calculates `invoicedReports.length` from those incoming props and uses that for the tab label.
- So if the invoiced report is older than the recent slice, the tab label shows `0` even though the report exists and appears once the invoiced tab loads full data.

Implementation
1. In `src/pages/Dashboard.tsx`, compute a separate `invoicedCount` from the full dashboard state arrays:
   - `inspections`
   - `trainings`
   - `dailyAssessments`
   intersected with `invoicedReportIds`.
2. Pass `invoicedCount` into `DashboardReportsSection` as its own prop.
3. In `src/components/dashboard/DashboardReportsSection.tsx`, use that new prop for the tab label instead of `invoicedReports.length`.
4. Leave everything else unchanged:
   - Recent vs All behavior
   - Invoiced tab content
   - Admin-only visibility
   - Filters, cards, navigation, and styling

Why this fix
- It targets only the incorrect badge/count source.
- No backend, permissions, or invoicing logic needs to change.
- It preserves the current content behavior while making the tab count accurate at all times.

Technical detail
```text
Current flow:
Dashboard (recent mode)
  -> passes sliced report arrays
DashboardReportsSection
  -> builds invoicedReports from sliced arrays
  -> tab label uses invoicedReports.length

Result:
Older invoiced reports are excluded from the badge count.
```

Validation
- With “Recent Reports” selected, the Invoiced tab should still show `1`.
- Clicking the Invoiced tab should still show the Southwest report.
- Switching between Recent and All should no longer make the Invoiced count drop incorrectly.
