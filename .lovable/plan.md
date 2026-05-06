## Goal

Remove the duplicate relative-date line on report cards. After the recent change, cards now show:

- `Created: 12 days ago` (new, labeled)
- `12 days ago` (old, unlabeled — this is the one to remove)
- `Edited 12 days ago` (drafts only, keep)

The unlabeled middle line was the original "report date" line driven by `getReportDate()` (inspection_date / assessment_date / training start_date). It's now visually redundant with the new `Created:` line and the user wants it gone.

## Change

Single file: `src/components/dashboard/ReportCard.tsx`

Delete this block (currently lines ~308-310):

```tsx
<p className="text-muted-foreground" title={dateInfo?.full}>
  {dateInfo ? dateInfo.relative : 'No date'}
</p>
```

`dateInfo` / `getRelativeDate()` / `getReportDate()` are no longer used after this removal, so remove the now-dead `const dateInfo = getRelativeDate();` line and the `getRelativeDate` helper as well to keep the file clean. `getReportDate()` itself stays only if still referenced elsewhere — it isn't, so remove it too.

Keep:
- `Created:` line (labeled, with tooltip)
- `Completed:` line (completed cards only)
- `Edited X ago` line (drafts only)

## Out of scope

No other layout, styling, or data changes.

## Verification

- Draft card: shows `Created: X ago` and `Edited X ago` only.
- Completed card: shows `Created: X ago` and `Completed: <date>` only.
- No duplicate relative-time line anywhere.
