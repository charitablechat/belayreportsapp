

## Add "Completed" Sort Option and Rename "Assignee" to "Inspector/Trainer"

### Changes

**1. `src/hooks/useDashboardFilters.tsx`**
- Add `'completed'` to the `SortOption` type union (line 5)
- Add a `case 'completed'` in the sort switch (line 231) that brings completed reports (tier 3) to the top after critical/warning items, reversing the default behavior where completed sink to the bottom
- Rename `'assignee'` sort label display only (keep the value as `'assignee'` internally)

**2. `src/components/dashboard/DashboardControls.tsx`**
- Add `<SelectItem value="completed">Completed</SelectItem>` to the sort dropdown (after Priority)
- Change the "Assignee" label in both dropdowns:
  - Sort dropdown: `Assignee` → `Inspector/Trainer`
  - Group-by dropdown: `Assignee` → `Inspector/Trainer`

**3. Sort logic for "completed" option:**
- Critical/warning items still pinned at top (immutable rule)
- Completed items sorted above active/normal drafts
- Within completed items, sort by date descending (most recently completed first)

