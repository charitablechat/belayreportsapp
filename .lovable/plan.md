

## Dashboard Enhancement Plan: Search, Filters, Sorting, Grouping, Pagination, and List View

This is a large feature set that will be implemented as new components extracted from the existing Dashboard, preserving all current escalation logic.

### Current Architecture

- `Dashboard.tsx` (1493 lines) — monolithic page with tabs: Inspections, Training, Daily
- `ReportCard.tsx` — card component with `getReportAgeState()` for escalation colors (critical/warning/completed/default)
- Sorting already pins critical (5+ day) cards first, then warning (3-4 day), then rest
- Super admins already have an inspector filter dropdown
- Recent/All toggle exists

### New Components to Create

**1. `src/components/dashboard/DashboardSearchBar.tsx`**
- Full-text search input filtering by organization, location, assignee name
- Sticky positioning, debounced input (300ms)

**2. `src/components/dashboard/DashboardFilters.tsx`**
- Status pill toggles (All / Draft / Completed)
- Assignee multi-select dropdown (populated from data)
- Date range picker (two Calendar popovers)
- Sync status toggle (All / Synced / Local)

**3. `src/components/dashboard/DashboardQuickFilters.tsx`**
- Chip row: "My Cards", "Due This Week", "Drafts Only", "Needs Attention"
- Each chip toggles on/off, works with AND logic alongside other filters

**4. `src/components/dashboard/DashboardControls.tsx`**
- Group-by dropdown: None / Status / Date / Assignee / Region
- Sort-by dropdown: Priority / Date Asc / Date Desc / Title A-Z / Assignee
- View toggle: Grid / List (icons)

**5. `src/components/dashboard/ReportListView.tsx`**
- Table view with columns: Title, Location, Date, Assignee, Status, Days Open, Sync
- Sortable column headers (click to sort, but red rows stay pinned at top)
- Days Open column color-coded to match escalation system
- Row click navigates to report

**6. `src/components/dashboard/DashboardPagination.tsx`**
- Grid: 24 per page, List: 50 per page
- Red (critical) cards always forced onto page 1

**7. `src/hooks/useDashboardFilters.tsx`**
- Central hook managing all filter/search/sort/group/pagination state
- Takes raw report array, returns filtered/sorted/grouped/paginated results
- Ensures critical cards are always pinned to top and page 1
- Groups return `{ label: string, count: number, items: any[] }[]` with "Needs Attention" always first
- Completed cards auto-pushed to collapsed section at bottom

### Changes to Existing Files

**`src/pages/Dashboard.tsx`**
- Import and wire up all new components in the Reports section (lines 1212-1456)
- Replace the inline `.sort()` and `.map()` blocks with the hook's output
- Add state for view mode, search, filters, sort, group, page
- The filter bar replaces the current super-admin-only inspector filter (which becomes part of the new Assignee filter)
- Wrap filter/search bar in a sticky container

**`src/components/dashboard/ReportCard.tsx`**
- No changes needed — card design and escalation colors preserved exactly

### Filter/Sort/Group Logic (in `useDashboardFilters`)

```text
Input: raw reports[] + filterState

1. Text search: match organization, location, assignee name (case-insensitive)
2. Status filter: match report status
3. Assignee filter: match inspector_id against selected IDs
4. Date range filter: report date within [start, end]
5. Sync filter: synced_at presence
6. Quick filters: "My Cards" → inspector_id === currentUser.id
                  "Due This Week" → draft + date within current week
                  "Drafts Only" → status === 'draft'
                  "Needs Attention" → ageState critical or warning
7. Sort: apply selected sort, BUT critical items always float to top
8. Group: partition into groups with headers; "Needs Attention" group always first
9. Completed section: separate completed items into collapsed bottom group
10. Pagination: slice results; inject any critical items from later pages into page 1
```

### Escalation Preservation Rules

- `getReportAgeState()` remains the single source of truth for card coloring
- All sort modes keep `tierOf()` as primary sort key (critical=0, warning=1, rest=2)
- Grouping always renders "Needs Attention" section first with critical+warning cards
- Pagination pre-scans for critical cards and forces them onto page 1
- No color changes to cards — salmon/yellow/red/white/green system untouched

### UI Layout (Reports Section)

```text
┌─────────────────────────────────────────────┐
│ [Search Bar ___________________________]    │  ← sticky
│ [All] [Draft] [Completed]  [Assignee ▼]     │
│ [Date Range]  [Sync: All ▼]                 │
│ [My Cards] [Due This Week] [Drafts Only]    │
│ [Needs Attention]                           │
│                                             │
│ Group by: [None ▼]  Sort: [Priority ▼]      │
│                              [Grid|List]    │
├─────────────────────────────────────────────┤
│ Inspections (12) | Training (5) | Daily (3) │  ← existing tabs
├─────────────────────────────────────────────┤
│ ┌─────┐ ┌─────┐ ┌─────┐                    │
│ │Card │ │Card │ │Card │  ← grid or table    │
│ └─────┘ └─────┘ └─────┘                    │
│                                             │
│ ▸ Completed (8) ← collapsed by default      │
│                                             │
│ [◀ 1 2 3 ▶]  ← pagination                  │
└─────────────────────────────────────────────┘
```

### Implementation Order

1. Create `useDashboardFilters` hook (core logic)
2. Create UI components (SearchBar, Filters, QuickFilters, Controls)
3. Create `ReportListView` table component
4. Create `DashboardPagination` component
5. Wire everything into `Dashboard.tsx`
6. Test escalation preservation (red cards pinned, colors intact)

