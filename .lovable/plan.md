## Cap split view to 10 per group (20 total)

When `viewMode === 'split'`, limit each group's rendered rows to 10 so the side-by-side layout stays balanced and short.

### Change

**File:** `src/hooks/useDashboardFilters.tsx`

In the `useMemo` that builds `paginatedGroups` (around lines 388–417), after pagination is applied and just before returning, add a split-mode cap:

- If `viewMode === 'split'`, map over `paginatedGroups` and replace each group's `items` with `items.slice(0, 10)`.
- Keep each group's `count` field at the original full count so the header badge (e.g. "Drafts 37") still reflects reality and signals there's more.
- This naturally yields the 20-total ceiling (Drafts ≤10 + Completed ≤10) the user asked for.

### Out of scope

- No changes to `list` or `grid` view counts/pagination.
- No change to badges, sorting, filters, or the Completed collapse behavior.
- No UI/style changes.