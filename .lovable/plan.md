## Color-code horizontal report rows

Match the old card view's age-based tinting on the full row background in `ReportListView.tsx`. Reuse the existing `getReportAgeState` helper from `ReportCard.tsx` so logic stays identical.

### Mapping (matches old cards, plus invoiced override)

- `invoiced` (admin + isInvoiced) → **purple** tint (overrides everything else)
- `critical` (>5 days, not completed) → **red** tint
- `warning` (>3 days, not completed) → **yellow** tint
- `completed` → **green** tint
- `default` (≤3 days, not completed) → current `bg-card`

### Changes

**`src/components/dashboard/ReportListView.tsx`**

1. Import `getReportAgeState` from `./ReportCard`.
2. In `ReportRow`, derive `ageState` from `report.created_at` + status (same call signature as old card).
3. Build a `rowTintClass` map mirroring the old card's `ageStateClasses` palette but tuned for a row (lighter so text stays readable, with matching dark-mode variants):
   - `critical`: `bg-red-100 dark:bg-red-950/40 hover:bg-red-100/80 dark:hover:bg-red-950/60`
   - `warning`: `bg-yellow-50 dark:bg-yellow-950/30 hover:bg-yellow-100/80 dark:hover:bg-yellow-950/50`
   - `completed`: `bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100/80 dark:hover:bg-emerald-950/50`
   - `default`: keep existing `bg-card hover:bg-accent/30`
4. Add an invoiced override class applied **after** the age tint (so it wins): `bg-purple-100 dark:bg-purple-950/40 hover:bg-purple-100/80 dark:hover:bg-purple-950/60`. Triggered by the same `isAdmin && isInvoiced` condition already present.
5. Apply via the existing `cn(...)` on the `<li>` — replace the current `bg-card ... hover:bg-accent/30` segment with the resolved tint class.
6. Keep the 3px left accent bar unchanged (still uses `getAccentClasses`).

### Out of scope

- No prop, type, query, or filter changes.
- No changes to `ReportCard.tsx`, `DashboardReportsSection.tsx`, `useDashboardFilters.tsx`, or `DashboardControls.tsx`.
- Grid (old card) view continues to use its existing colors.
- Tailwind palette colors used (`red/yellow/emerald/purple`) match what the old card already uses in this file's siblings; no new tokens needed.