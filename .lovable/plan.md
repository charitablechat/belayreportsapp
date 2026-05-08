## Recolor "completed" rows from green to blue

Now that invoiced is teal, shift completed reports from emerald to a clean blue so the four states read distinctly:

- critical (overdue) — red
- warning (>3d) — yellow
- **completed — blue** (was emerald)
- invoiced — teal
- default — neutral card

### Color choice

Standard `sky` palette — bright, calm, unmistakably "done" without competing with the teal of invoiced or the amber of warning:

- Row tint: `bg-sky-50 hover:bg-sky-100/80 dark:bg-sky-950/30 dark:hover:bg-sky-950/50`
- Left accent bar (3px): `bg-sky-500`
- Status pill ("completed"): `bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900`

### Files

1. **`src/components/dashboard/ReportListView.tsx`**
   - `ROW_TINT_CLASSES.completed`: emerald → sky.
   - `getAccentClasses`: the `status === "completed"` branch returns `bg-sky-500` (the `age <= 7` branch keeps `bg-emerald-500` so brand-new in-progress rows still feel fresh-green; only the completed status itself turns blue).
   - `getStatusPillClasses` `case "completed"`: emerald → sky tokens.

2. **`src/components/dashboard/ReportCard.tsx`** (grid view)
   - Find the equivalent completed-state styling (`ageStateClasses.completed` / completed-status pill) and swap emerald → sky to match.

### Out of scope

- No change to invoiced (teal), critical (red), warning (yellow), or default tints.
- No change to the "Completed" stat tile in `DashboardStatsBar` unless you also want it recolored — happy to include it on request.
- No data, filter, or query changes.
