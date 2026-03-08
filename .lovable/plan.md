

## Comprehensive Architectural Review: Dashboard Filter/Sort/Group System

### Components Under Review

1. **`useDashboardFilters`** — central hook for filter/sort/group/pagination logic
2. **`DashboardReportsSection`** — orchestrator component
3. **`DashboardSearchBar`** — debounced search input
4. **`DashboardFilters`** — status pills, assignee, date range, sync filter
5. **`DashboardQuickFilters`** — quick-filter chip row
6. **`DashboardControls`** — sort/group/view-mode controls
7. **`ReportListView`** — table view
8. **`DashboardPagination`** — page navigation
9. **`Dashboard.tsx`** — parent page wiring

---

### Issue 1: Filter State Resets on Tab Switch (HIGH)

**Problem:** `useDashboardFilters` is called inside `DashboardReportsSection`, which receives `currentReports` based on `activeReportTab`. When the user switches tabs (Inspections → Training), the hook keeps the same filter state (e.g. assignee IDs, status values) but the new dataset may not match those filters — resulting in 0 results with no explanation.

**Fix:** Reset filters (or at minimum `assigneeFilter` and `statusFilter`) when `activeReportTab` changes. Add a `useEffect` in `DashboardReportsSection` that calls `clearAllFilters()` when `activeReportTab` changes.

---

### Issue 2: "Completed" Sort Ignores Other Active Filters Partially (MEDIUM)

**Problem:** When `sortBy === 'completed'`, the code filters from the already-filtered array (`filtered`), applies `status === 'completed'` filter, then slices to 9. But status filter pills, quick filters like "Drafts Only", and search are applied before this — so if a user has "Drafts Only" active AND selects "Completed" sort, they get 0 results with no feedback. The UX is confusing.

**Fix:** When "Completed" sort is selected, auto-clear conflicting quick filters (`draftsOnly`) and set `statusFilter` to `'all'` or `'completed'` to avoid dead-end combinations.

---

### Issue 3: Pagination Does Not Apply to Grouped Mode (MEDIUM)

**Problem:** Pagination only applies when `groupBy === 'none'` (line 372). When grouping is active, ALL items in ALL groups render at once — potentially hundreds of cards with no pagination. This is a performance and UX concern for large datasets.

**Fix:** Apply pagination across grouped items. Flatten groups → paginate → re-partition into groups for the current page. Or add a per-group "show more" limit (e.g. 12 items per group with expand).

---

### Issue 4: `uniqueInspectors` Computed from Wrong Scope (MEDIUM)

**Problem:** `uniqueInspectors` is computed in `Dashboard.tsx` from ALL inspections, trainings, and daily assessments combined. When the user is on the Training tab and opens the Assignee filter, they see inspectors from other tabs too. This is misleading — selecting an inspector who has no trainings yields 0 results.

**Fix:** Compute `uniqueInspectors` per tab inside `DashboardReportsSection` based on `currentReports`, not the global merged list.

---

### Issue 5: Duplicate `getReportDate`/`getAssigneeName` Functions (LOW)

**Problem:** `getReportDate` and `getAssigneeName` are defined identically in both `useDashboardFilters.tsx` and `ReportListView.tsx`. This violates DRY and risks divergence.

**Fix:** Extract to a shared utility file (e.g. `src/lib/report-utils.ts` or add to existing one).

---

### Issue 6: Training `getReportDate` Inconsistency (LOW)

**Problem:** In `useDashboardFilters`, training date falls back to `report.training?.start_date || report.start_date || report.created_at`. In `ReportListView`, it falls back to `report.training?.start_date || report.start_date || ''` (no `created_at` fallback). This means the list view may show "—" for a training that the filter hook considers to have a date.

**Fix:** Unify the fallback chain in the shared utility.

---

### Issue 7: `tierOf()` Uses `created_at` but Cards May Lack It (LOW)

**Problem:** `tierOf()` calculates age from `r.created_at`. Locally-created offline reports may have a `created_at` set to a local timestamp that drifts if the device clock is wrong. Also, `new Date(null)` returns `Invalid Date`, and `differenceInDays(new Date(), Invalid Date)` returns `NaN`, which means `NaN > 5` is false — so broken dates silently default to tier 2 (no escalation). This is a silent failure that hides overdue reports.

**Fix:** Add a guard: if `created_at` is falsy or date is invalid, default to tier 0 (critical) as a safety measure — better to over-escalate than hide.

---

### Issue 8: Search Debounce `useEffect` Missing Dependency (LOW)

**Problem:** `DashboardSearchBar` line 15: `useEffect(() => { ... }, [local])` — missing `onChange` in deps. If `onChange` changes identity (it will on every parent re-render since it's an inline arrow), the timeout fires with a stale reference. Currently harmless because `updateFilter` is `useCallback`-wrapped, but fragile.

**Fix:** Add `onChange` to the dependency array.

---

### Issue 9: Sync Value Comparison for External Value (LOW)

**Problem:** `DashboardSearchBar` line 20: `useEffect(() => { if (value !== local) setLocal(value); }, [value])` — missing `local` in deps. This is intentional to avoid loops, but the pattern is fragile and can cause React strict-mode double-render issues.

**Fix:** This is acceptable as-is but should have a comment explaining the intentional dep omission.

---

### Issue 10: Date Range Filter Off-By-One (LOW)

**Problem:** Date range comparison uses `date < dateRange.from` and `date > dateRange.to`. Since dates from the calendar picker are midnight-based, a report dated the same day as `dateRange.to` at any time after midnight will be excluded. Should use `<=` / `>=` or normalize to start/end of day.

**Fix:** Normalize `dateRange.to` to end-of-day before comparison, or use `date-fns` `isSameDay`/`isWithinInterval`.

---

### Issue 11: Completed Section Label Includes Count Redundantly (COSMETIC)

**Problem:** The completed group label is `Completed (${count})` AND the UI renders a `<Badge>` with `group.count`. So users see "Completed (8)" followed by a badge "8".

**Fix:** Use just "Completed" as the label, let the badge show the count.

---

### Issue 12: No Accessibility on Status Pills (LOW)

**Problem:** Status filter pills in `DashboardFilters` use raw `<button>` elements without `aria-pressed` or `role="tab"` attributes. Screen readers won't convey selection state.

**Fix:** Add `aria-pressed={statusFilter === s}` to each status button.

---

---

### Implementation Plan

**Phase 1 — Critical Fixes (correctness)**
1. Fix tab-switch filter reset (Issue 1)
2. Fix "Completed" sort + conflicting filters dead-end (Issue 2)
3. Guard `tierOf()` against invalid dates (Issue 7)
4. Fix date range off-by-one (Issue 10)

**Phase 2 — Performance and UX**
5. Add pagination support for grouped mode (Issue 3)
6. Scope `uniqueInspectors` to current tab (Issue 4)
7. Fix completed label redundancy (Issue 11)

**Phase 3 — Code Quality**
8. Extract shared report utility functions (Issues 5, 6)
9. Fix search bar useEffect deps (Issue 8)
10. Add accessibility attributes (Issue 12)

