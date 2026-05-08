## Goal

Add a third option, **Split**, to the existing List/Grid segmented toggle. Split renders the same horizontal row cards as List, but in two columns on screens ≥ md and falls back to a single column below md.

## Mapping to real files

The screenshots show a toggle that, in this codebase, lives in `DashboardControls.tsx` (the only viewMode toggle that exists). The earlier-described `RecentReportsGrid.tsx`, the Dashboard.tsx tab-level toggle, and the `dashboard.recentViewMode` / `dashboard.tabsViewMode` localStorage keys do not exist here, so they're out of scope.

## Changes

### 1. `src/components/dashboard/ReportListView.tsx`
- Add `twoColumn?: boolean` prop.
- Swap the outer container based on the prop:
  - default → `<ul className="flex flex-col gap-2">` (unchanged)
  - `twoColumn` → `<ul className="grid grid-cols-1 md:grid-cols-2 gap-2">`
- When `twoColumn` is true, auto-imply `compact` if the caller didn't pass it explicitly. `compact` and `twoColumn` stay independent props.
- Row internals are unchanged.

### 2. `src/hooks/useDashboardFilters.tsx`
- Widen `ViewMode`: `'grid' | 'list'` → `'grid' | 'list' | 'split'`.
- Pagination size: treat `'split'` like `'list'` (use `LIST_PAGE_SIZE`). One-line change in the existing ternary.

### 3. `src/components/dashboard/DashboardControls.tsx`
- Add a third `<Button>` between List and Grid, with the `Columns2` lucide icon and `aria-label="Split"`, active when `viewMode === 'split'`. Reuses the existing segmented-switch styles.

### 4. `src/components/dashboard/DashboardReportsSection.tsx`
- Update the four render branches that currently switch on `filters.viewMode === 'list'`:
  - The two main render paths (lines ~647 and ~682) and the `CrossTabSection` path (~761).
  - New logic: render `ReportListView` with `twoColumn` when `viewMode === 'split'`, otherwise keep the existing list/grid behavior.
- Widen `CrossTabSectionProps.viewMode` from `'grid' | 'list'` to `'grid' | 'list' | 'split'` so it can pass through.

```text
viewMode === 'list'  → <ReportListView ...props />
viewMode === 'split' → <ReportListView twoColumn ...props />
viewMode === 'grid'  → existing ReportCard grid (unchanged)
```

## Out of scope

- No data, query, RLS, or business-logic changes.
- No new component file.
- No `RecentReportsGrid.tsx` or Dashboard.tsx toggle (don't exist).
- No localStorage persistence (existing toggle is React state only; can be added later if requested).
- Inventory / `invoiced` tab: no special handling — Split applies uniformly anywhere the toggle is shown.

## Files touched

- `src/components/dashboard/ReportListView.tsx`
- `src/components/dashboard/DashboardControls.tsx`
- `src/components/dashboard/DashboardReportsSection.tsx`
- `src/hooks/useDashboardFilters.tsx`
