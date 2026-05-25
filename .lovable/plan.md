## Goal

In the dashboard list/two-column row view, the small right-aligned date pill currently always renders the report's primary date (`inspection_date` / `assessment_date` / training `start_date`). For rows whose status is `completed`, render the **submission (completion) date** instead. All other statuses are unchanged.

## Scope

Single component, single render site:

- `src/components/dashboard/ReportListView.tsx` — the date pill at lines ~304–307:
  ```tsx
  <div className="hidden md:block shrink-0 text-xs text-muted-foreground tabular-nums w-[92px] text-right">
    {parsed ? format(parsed, "MMM d, yyyy") : "—"}
  </div>
  ```

No changes to `ReportCard.tsx` (card view already shows an explicit "Completed:" line), no styles, no layout, no data fetching, no other fields.

## Logic

Mirror the completion-timestamp resolution already used in `ReportCard.tsx`:

```ts
const submittedAtRaw =
  status === "completed"
    ? (report.attestation_signed_at || report.updated_at)
    : null;
const submittedAt = submittedAtRaw ? new Date(submittedAtRaw) : null;

const displayDate =
  status === "completed" && submittedAt ? submittedAt : parsed;
```

Render `displayDate` in the same pill with the same `MMM d, yyyy` format and same width/classes. Fallback to `parsed` if `attestation_signed_at`/`updated_at` are both missing (defensive — keeps the column from going blank).

Optional polish (kept inside the same element, no layout change): wrap the pill in the existing `Tooltip` pattern so hovering a completed row's date shows "Submitted {PPpp}", matching the tooltip pattern already used elsewhere in this file. If this expands scope at all, skip it and leave as plain text.

## Tests

Add `src/components/dashboard/__tests__/ReportListView.submitted-date.test.tsx`:

1. `status: "draft"` with `inspection_date: 2026-05-10` and `updated_at: 2026-05-20` → renders **May 10, 2026**.
2. `status: "completed"` with `inspection_date: 2026-05-10`, `attestation_signed_at: 2026-05-22T15:00:00Z` → renders **May 22, 2026**.
3. `status: "completed"` with no `attestation_signed_at`, `updated_at: 2026-05-21T15:00:00Z` → renders **May 21, 2026**.
4. `status: "completed"` with neither field set → falls back to the report's primary date.

## Validation

- Run the new test file + existing `ReportListView`/`ReportCard` tests.
- Run the full Vitest suite; report pass count.
- Visual check at `/` against the screenshots: completed rows in list and two-column view show the completion date; draft/in-progress rows are unchanged.

## Out of scope (explicit)

- `ReportCard.tsx` grid view
- Date column width, font, color, tooltip styling beyond the optional Submitted tooltip
- `getReportDate`, loaders, savers, schema, RLS, edge functions
- Any inspection / daily-assessment / training PDF or HTML generation
- Any sync, photo, or auth code paths
