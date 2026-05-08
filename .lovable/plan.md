## Restore full list view; keep 10-cap only for split view

The 10-row cap should apply only to split (two-column / collapsed) view. In the expanded list view, users need to see all their reports (paged as before).

### Change

**File:** `src/hooks/useDashboardFilters.tsx`

- Revert `LIST_PAGE_SIZE` from `10` back to `50`. List view will once again show 50 rows per page with normal pagination, so users can reach every report.
- Leave the split-view cap intact: the post-pagination `viewMode === 'split'` slice to 10 items per group (Drafts ≤10 + Completed ≤10) stays as is.

### Out of scope

- No change to grid view (`GRID_PAGE_SIZE = 24`).
- No change to grouping, sorting, filters, or any styling.