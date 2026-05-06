## Goal

Show two muted metadata lines on every report card (Inspection, Training, Daily Assessment) directly beneath the location field and above the inspector avatar/name row:

```
Created: 27 days ago
Completed: May 4, 2026
```

The current "27 days ago" line that lives by itself today is being replaced with the explicit "Created:" label so it reads correctly and pairs with the new "Completed:" line.

## Where

Single file: `src/components/dashboard/ReportCard.tsx` — the block at lines 276–294 between the location `<p>` and the inspector `<div className="flex items-center gap-2">` row.

No other files change. No business logic, no data-flow, no new props.

## Behavior

- **Created line** — always rendered when `report.created_at` exists.
  - Value: `formatDistanceToNow(new Date(report.created_at), { addSuffix: true })`, e.g. `27 days ago`.
  - Already auto-refreshes every 60 s via the existing `useMinuteTick()` subscription, so it stays live in past/present/future without a page reload.
  - Tooltip on hover shows the absolute timestamp (`format(..., "PPpp")`).

- **Completed line** — only rendered when the report is completed.
  - Source priority: `report.attestation_signed_at` → fallback to `report.updated_at` (only used when `status === 'completed'`, since the row's `updated_at` flips at completion). All three report types persist `attestation_signed_at` on completion (see `daily_assessments`/`inspections`/`trainings` schema), so this is the canonical completion timestamp.
  - Format: `format(parsed, "PP")`, e.g. `May 4, 2026`. Tooltip shows full `"PPpp"`.
  - Hidden entirely on draft cards.

- **"Edited X ago"** line (only shown on non-completed cards) is preserved as-is.

## Styling

Match the surrounding muted typography exactly so visual hierarchy stays on the org name and status badge:

- Both lines use `text-muted-foreground/80 font-mono text-[11px] tracking-wide` — slightly tighter and mono to land the retro feel without inventing a new token.
- Label (`Created:` / `Completed:`) uses `uppercase tracking-[0.14em] text-muted-foreground/60 mr-1.5` for the small-caps retro vibe.
- No new colors, no new shadow tokens, no new Tailwind config additions — design system unchanged.

## Layout (final order inside `space-y-2`)

1. Location (existing)
2. **Created: {relative}** ← new label, replaces today's standalone relative-date line
3. **Completed: {date}** ← new, completed cards only
4. Edited X ago (existing, drafts only)
5. Inspector avatar + name (existing)
6. Status / sync badges row (existing)

## Out of scope

- No changes to `OrganizationReportsPanel`, dashboard filters, sync engine, or any data layer.
- No changes to the `COMPLETED` watermark overlay.
- No new props on `ReportCard`.

## Verification

- Visit `/dashboard`: completed cards show both lines, drafts show only the Created line.
- Hover each line: tooltip with full timestamp appears.
- Toggle a card from draft → completed (or open one already completed): Completed line appears using `attestation_signed_at`.
- Wait 60 s on the dashboard: relative time on Created line ticks forward (proves the live/"present/future-active" behavior via the existing minute-tick).
