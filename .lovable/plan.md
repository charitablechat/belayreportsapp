## Goal

Inside the shaded "INVOICED" badge on completed report cards, render the invoice timestamp and the user who marked it, fetched live from `invoiced_reports`. Keep the layout compact and non-overflowing.

## Where the change lives

- `src/pages/Dashboard.tsx` — `invoicedQuery` (lines ~253-268) currently stores only a `Set<string>` of `report_id`. Extend it to also expose `invoiced_at` and `invoiced_by`.
- `src/components/dashboard/DashboardReportsSection.tsx` — pass new metadata prop through to `ReportCard`.
- `src/components/dashboard/ReportCard.tsx` — render the metadata lines inside the existing red `INVOICED` badge (lines 205-209).

## Data flow

1. **Query**: change `invoicedQuery` to `select("report_id, invoiced_at, invoiced_by")` and return `Map<reportId, { invoiced_at: string; invoiced_by: string | null }>`. Keep `invoicedReportIds` (a `Set` view) for existing `.has()` callers; derive it from the map's keys so nothing else breaks. Update `handleToggleInvoiced` cache writes to `setQueryData` on the Map (delete entry on removal; add `{ invoiced_at: new Date().toISOString(), invoiced_by: user?.id ?? null }` on insert).
2. **Prop plumbing**: `DashboardReportsSection` already receives `invoicedReportIds`; also accept `invoicedMeta` (the Map) and pass `invoicedMeta?.get(report.id)` as a new `invoicedMeta` prop on each `<ReportCard>`.
3. **ReportCard**: add optional prop `invoicedMeta?: { invoiced_at: string; invoiced_by: string | null }`. Use the existing `profilesById` map to resolve `invoiced_by` to a display name (`first_name last_name`, falling back to a short id slice or "Unknown").

## UI inside the INVOICED badge

Replace the single `INVOICED` span (currently `whitespace-nowrap`) with a small flex column:

```
INVOICED                 ← existing big red label, kept as-is visually
Mar 4, 2026 · 2:14 PM    ← text-[11px], muted/red-400
by Jane Doe              ← text-[11px], muted/red-400
```

Implementation notes:
- Wrap label + meta in a `flex flex-col items-center gap-1` container; remove `whitespace-nowrap` from the outer wrapper and apply it only to the big "INVOICED" word so it never wraps but the meta lines can.
- Meta block: `text-[11px] font-medium tracking-normal opacity-80 leading-tight text-center`, no rotation override needed (inherits the parent `rotate-[25deg]`). Use `max-w-[80%]` with `break-words` to guarantee no overflow.
- Format timestamp with `format(new Date(invoiced_at), "PP · p")` from `date-fns` (already used elsewhere in the file).
- If `invoicedMeta` is missing (e.g., legacy rows), render only the `INVOICED` label — no empty lines.

## Out of scope

- No DB migrations (columns already exist).
- No changes to the `useInvoicedStatus` hook (used on form pages, not on dashboard cards).
- No changes to PDF/HTML report output.

## Verification

- Mark a completed report as invoiced → badge shows current timestamp and current admin's name immediately (optimistic cache).
- Refresh dashboard → values persist (read from DB).
- Remove invoice → metadata disappears with the badge.
- Long admin names wrap inside the badge without breaking the card layout at 320px width.
