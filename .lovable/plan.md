

# Add "All Reports" Section to Dashboard

## Overview

Add a new "All Reports" navigation section alongside the existing "Recent Reports" section. "Recent Reports" will be capped at 9 reports per tab, while "All Reports" shows the complete set.

## Current State

- The dashboard fetches all reports into `inspections`, `trainings`, and `dailyAssessments` state arrays
- These are displayed in a single "Recent Reports" section with no limit
- Data fetching already uses optimized column selection (no `latest_report_html`)
- RLS policies already handle Super Admin vs. standard user visibility

## Implementation

### 1. Add a top-level section toggle (Recent Reports / All Reports)

Add a new state variable `reportSection` (`"recent"` | `"all"`) and render two clickable section headers (styled as a segmented control or tab bar) above the existing Inspections/Training/Daily tabs.

### 2. Cap "Recent Reports" at 9

When `reportSection === "recent"`, slice each sorted array to `.slice(0, 9)` before rendering. The tab counts will reflect the sliced count (e.g., "Inspections (9)").

### 3. "All Reports" shows everything

When `reportSection === "all"`, render the full arrays with their existing sort logic. Tab counts show the full totals.

### 4. No new data fetching required

Both sections use the same `inspections`, `trainings`, and `dailyAssessments` arrays that are already loaded. The only difference is whether `.slice(0, 9)` is applied. This means zero additional network requests and instant switching.

### 5. UI Layout

```text
+-----------------------------+
| [Recent Reports] [All Reports] |   <-- section toggle
+-----------------------------+
| Inspections | Training | Daily |   <-- existing sub-tabs
+-----------------------------+
| Report cards grid              |
+-----------------------------+
```

The section toggle will use a `Tabs` component with a distinct visual style (e.g., larger, bolder) to differentiate it from the sub-tabs. The active section will be clearly highlighted.

## File Changes

### `src/pages/Dashboard.tsx`

1. Add state: `const [reportSection, setReportSection] = useState<"recent" | "all">("recent");`
2. Add a top-level `Tabs` wrapper around the section header area with `"recent"` and `"all"` triggers
3. Compute display arrays based on section:
   ```typescript
   const displayInspections = reportSection === "recent" 
     ? sortedInspections.slice(0, 9) 
     : sortedInspections;
   ```
4. Update tab count badges to reflect the displayed count
5. No changes to data loading, offline logic, delete handlers, or sync -- all remain identical

## Technical Notes

- No database changes or new queries needed
- No new dependencies
- Offline/IndexedDB behavior unchanged -- both sections draw from the same cached data
- Super Admin filter dropdown works identically in both sections
- The tier-based priority sorting (critical > warning > default) applies in both sections, ensuring the most urgent reports appear first in "Recent Reports"
- Mobile-responsive: the section toggle will stack or scroll horizontally on small screens

