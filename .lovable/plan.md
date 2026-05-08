## Push non-invoiced reports to top of Completed group

In the Completed section, reports that haven't been invoiced should appear first; invoiced ones drop below. This makes outstanding billing work visible at a glance without changing the within-status order otherwise.

### Change

**File:** `src/components/dashboard/DashboardReportsSection.tsx`

In the `groups.map(...)` render block (around line 613), when `group.label === 'Completed'` and `invoicedReportIds` is available, derive a sorted copy:

- Stable partition: items where `!invoicedReportIds.has(report.id)` first, then invoiced items, preserving each subgroup's existing date-desc order.
- Use the sorted array as `group.items` when rendering rows/cards.

Apply in both branches that render groups (the `showHeader` Collapsible branch and the `!showHeader` branch) so list, split, and grid views all benefit.

### Out of scope

- No change to grouping, filtering, or pagination logic in `useDashboardFilters`.
- No change to Drafts ordering.
- No styling changes — invoiced rows keep the teal tint and `$ Invoiced` chip.