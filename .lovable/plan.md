

# Cross-Tab Search on Dashboard

## Problem
Currently, the search bar only filters reports within the active tab (Inspections, Training, or Daily). When you type a search query, you only see matches from the tab you're on, missing results in other tabs.

## Solution
When a search query is entered, automatically search across all three report types and display combined results grouped by type -- regardless of which tab is active. When the search is cleared, revert to normal tab-based browsing.

## How it works

1. **DashboardReportsSection.tsx** -- Main changes:
   - Detect when a search query is active
   - When searching: combine all inspections, trainings, and daily assessments into a single list, tagging each with its report type
   - Run the text search filter across all combined reports
   - Display results grouped into three sections (Inspections, Training, Daily) with counts, hiding empty sections
   - Replace the tab UI with a "Searching all reports" indicator and result counts per type
   - When search is cleared: restore normal tab-based view

2. **useDashboardFilters.tsx** -- Minor adjustment:
   - The hook already handles text search filtering. For cross-tab mode, we'll run three separate filter instances (one per type) or do a simpler pre-filter before passing to the hook
   - Simplest approach: do the cross-tab text matching inline in the component, bypassing the per-tab hook when in search mode

3. **Visual behavior**:
   - Tabs remain visible but become secondary when searching (results span all types)
   - Each result group shows its type label and count (e.g., "Inspections (3)", "Training (1)")
   - Clicking a result navigates to the correct report type's form
   - Search result count shows total across all types

## Technical approach

In `DashboardReportsSection`, when `filters.search` is non-empty:
- Create three filtered arrays by applying the search text to inspections, trainings, and dailyAssessments independently
- Render all three sections inline (skipping empty ones) instead of rendering the active tab's content
- Each section uses its correct `type` for navigation and display
- The existing `ReportCard` component already accepts a `type` prop, so cards render correctly per type

## Files modified
- `src/components/dashboard/DashboardReportsSection.tsx`

