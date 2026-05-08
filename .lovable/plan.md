## Hide "Completed" pill in split view when invoiced

In split (two-column) view, the row is tight. When a report is both invoiced and completed, the green "$ Invoiced" chip already conveys the state, so the redundant "Completed" status pill can be dropped to give the report name more horizontal room.

### Change

**File:** `src/components/dashboard/ReportListView.tsx`

1. Pass `twoColumn` down from the parent list component into each `Row` (it's already a prop on `ReportListView` but not currently forwarded to the row). Add `twoColumn?: boolean` to the row's props and pass it where rows are rendered.
2. In the status-pill block (lines ~225–234), suppress the pill when `twoColumn && isAdmin && isInvoiced && status === "completed"`. All other views/states render the pill exactly as today.

### Out of scope

- No change to list view, grid view, or non-invoiced rows.
- No change to the "$ Invoiced" chip, row tint, accent bar, or row layout/spacing.
- No change to `ReportCard` (grid view).