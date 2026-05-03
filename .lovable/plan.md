## What the video shows

On the dashboard, the user clicks **Next** and **2** in the pagination bar repeatedly. The page indicator changes, but the visible report cards (Camp Balcones Springs, Harris County Sheriff, etc. — all `completed` + `Synced`) stay exactly the same. Effectively, pagination does nothing.

## Root cause

In `src/hooks/useDashboardFilters.tsx` (the pagination block, ~lines 371–398):

1. Reports are split into two groups: a main group (Drafts / active items) and a separate **Completed** group rendered collapsed at the bottom.
2. `totalPages` is computed from **all items combined**:
   ```ts
   const allItems = groups.flatMap(g => g.items);
   const totalPages = Math.ceil(allItems.length / pageSize);
   ```
3. But only the **main group** is sliced by page. The Completed group is then pushed back **in full** on every page:
   ```ts
   if (groups.length > 1) {
     paginatedGroups.push(groups[groups.length - 1]); // full completed group, unsliced
   }
   ```

Result: when a user has few drafts (≤ 24) but many completed reports, `totalPages` becomes >1 (so Previous/1/2/Next renders), but every page shows:
- Page 1: drafts (if any) + **all** completed
- Page 2: empty drafts slice + **all** completed (the same cards)

That's exactly the symptom in the video — all visible cards are completed ones, and they don't change between pages.

A second, related bug: on page ≥ 2, the code filters the main-group slice to `tierOf(r) > 1` to keep criticals on page 1. Since the main group never contains tier-3 (completed) items in the first place, this just empties the slice, reinforcing the "nothing changes" feeling.

## Fix

Edit `src/hooks/useDashboardFilters.tsx` so pagination is driven by the **main (paginatable) group only**, and the always-on completed section is appended without affecting page count.

Specifically, in the pagination block:

1. Identify the main group vs. the always-rendered completed group up front (the completed group is the one with `label === 'Completed'`).
2. Compute `totalPages` from `mainGroup.items.length` only, not from `allItems`.
3. Slice the main group by `currentPage` as today.
4. Append the completed group unchanged after the sliced main group.
5. Drop the `tierOf(r) > 1` filter on page ≥ 2 — it has no effect now that completed items are never in the main group, and removing it makes the intent clearer. (Critical items still naturally land at the top of page 1 because of the existing sort order.)
6. When `groupBy !== 'none'` (user picked Group By Status / Date / Assignee / Region), the same problem exists — paginated rendering currently does nothing in that branch. Apply the same approach: paginate across the flattened non-completed groups, append Completed at the bottom unchanged.

No UI changes are needed in `DashboardPagination.tsx` or `DashboardReportsSection.tsx`. The hook's public shape stays the same (`groups`, `totalPages`, `currentPage`).

## Verification after the change

1. Dashboard with 30+ completed reports and 0–5 drafts: pagination either disappears (if the main group fits on one page) or, if it shows, clicking Next visibly changes the cards in the main section.
2. Dashboard with 50+ active drafts: Next/Previous cycles through them; the Completed section at the bottom is identical on every page.
3. Switching tabs (Inspections / Training / Daily) still resets to page 1 (existing `clearAllFilters` on tab change).
4. Group-By modes (Status, Date, Assignee, Region): pagination buttons reflect items in the grouped sections and actually change the visible groups/items per page.
