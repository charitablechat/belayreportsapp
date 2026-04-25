# Remove the "Avg Completion Time" card from the admin dashboard

## What's being removed

The greyed-out **Avg Completion Time** card (`359.8h`) on the admin dashboard's third stats row, plus all of its supporting code. It's currently disabled (`pointer-events-none opacity-40`) because the underlying timer accuracy was never resolved, so the simplest path is to delete it entirely.

The neighboring **This Month** card stays. Nothing else on the dashboard is affected.

## Changes — all in `src/pages/SuperAdminDashboard.tsx`

1. **State** — remove `resetMetricDialogOpen` (line 70).
2. **Queries** — remove the two `useQuery` blocks (lines 334–399):
   - `["admin-settings", "avg_completion_time_reset_at"]` — fetches the reset timestamp from `admin_settings`.
   - `["avg-completion-time", …]` — calculates avg / min / max / sample / active-tracked from `inspections`.
   - And the `avgCompletionTime` derived value.
3. **Handler** — remove `handleResetCompletionTime` (lines 587–605).
4. **UI** — remove the disabled `<StatCard title="Avg Completion Time" …>` block and its wrapping `<div className="opacity-40 …">` (lines 811–854). The "Reports — Row 3" grid keeps the **This Month** card; with one card left, change the grid to `md:grid-cols-1` (or just keep `lg:grid-cols-3` so it sits flush-left — confirm which you prefer; default to keeping the existing classes so the card sits in its current slot).
5. **Reset Confirmation Dialog** — remove the `<AlertDialog>` block at lines 2003–2026.
6. **Imports** — drop `Clock` and `RotateCcw` from the `lucide-react` import if they're no longer referenced after the cleanup. Leave everything else intact.

## Out of scope

- The `admin_settings` row with key `avg_completion_time_reset_at` in the database is left untouched (harmless, no UI reads it). Removing it would need a migration; let me know if you want one.
- Inspection columns `started_at` and `active_duration_seconds` stay — they're still written from `InspectionForm.tsx` and may be useful elsewhere.
- All other StatCards (Inspections, Trainings, Daily Assessments, This Month, etc.) are untouched.

## Verification

- `bunx tsc --noEmit` clean.
- Admin dashboard loads with the third row now showing only the **This Month** card; no console errors; no orphaned imports.
