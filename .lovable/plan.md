## Move the view-mode toggle next to the group header

Currently the List / Split / Grid segmented toggle lives in the sticky filter bar on the far right (inside `DashboardControls`). Move it so it sits inline with the group header row — right of the "Drafts 5" label (and right of every other group header like "Overdue", "Completed", etc.), pushed to the right edge with `ml-auto`.

### Behavior

- The toggle appears once per group header, right-aligned on the same line as the group label + count badge.
- It controls the same `filters.viewMode` it does today — clicking it re-renders all groups in the new view (list / split / grid).
- When there are no group headers (single ungrouped list, `showHeader === false`), the toggle renders once as a small right-aligned bar directly above the list so it remains accessible.
- The toggle is removed from `DashboardControls` entirely; sort + group dropdowns stay where they are.

### Files

1. **`src/components/dashboard/ViewModeToggle.tsx`** (new, ~25 lines) — extract the segmented `List / Columns2 / LayoutGrid` button group from `DashboardControls.tsx` into a small reusable component. Props: `viewMode`, `onViewModeChange`. Same styling as today (`h-8 w-8`, `rounded-none`, `bg-accent` on active).

2. **`src/components/dashboard/DashboardControls.tsx`** — remove the segmented view-mode `<div>` and the `viewMode` / `onViewModeChange` props. Keep the Group-by and Sort-by selects.

3. **`src/components/dashboard/DashboardReportsSection.tsx`**
   - Stop passing `viewMode` / `onViewModeChange` to `<DashboardControls>`.
   - Inside the group-header `CollapsibleTrigger` (around line 638), change the wrapping from a `<button>`-style trigger to a flex row that contains: chevron + label + badge + (collapsed summary) on the left, and `<ViewModeToggle>` on the right via `ml-auto`. The toggle must `e.stopPropagation()` on click so toggling view doesn't collapse the group, and should be wrapped in a non-trigger element (use `CollapsibleTrigger asChild` on the inner left cluster only, with the toggle rendered as a sibling outside the trigger inside the same flex row).
   - For the `!showHeader` branch (around line 690), render a small `<div className="flex justify-end mb-3"><ViewModeToggle ... /></div>` above the list/grid so the control is still reachable.

### Out of scope

- No changes to filtering, sorting, grouping logic.
- No changes to row tinting, stats bar, quick filters, or the Inventory tab.
- Toggle still does not appear on the Inventory tab (consistent with prior behavior).
