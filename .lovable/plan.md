## Findings

The Submission Date in the Training Summary section renders one day earlier than today in negative-UTC timezones (user is in America/Chicago; screenshot shows "May 21st, 2026" on May 22, 2026).

### Root cause

`src/components/training/TrainingSummarySection.tsx` parses the stored `YYYY-MM-DD` date with the bare `new Date(...)` constructor:

```tsx
{summary?.submission_date ? format(new Date(summary.submission_date), "PPP") : "Pick a date"}
...
selected={summary?.submission_date ? new Date(summary.submission_date) : undefined}
```

Per the ECMAScript spec, `new Date("2026-05-22")` is parsed as **UTC midnight**, then rendered in local time. In any timezone west of UTC, that becomes the previous calendar day. So the value stored by the autofill (`format(new Date(), 'yyyy-MM-dd')` — which correctly produces today's local date, `2026-05-22`) is later re-parsed as UTC and displayed as `May 21st`.

The autofill helper itself (`src/lib/training-summary-autofill.ts`) and the writer (`onUpdate('submission_date', format(date, 'yyyy-MM-dd'))`) are correct. The bug is purely on the **display/parse side** of the date picker. This matches the existing "Report Date Integrity v2" memory: YYYY-MM-DD strings must be parsed timezone-agnostically.

### Proposed fix (narrow, frontend-only)

1. Add a tiny shared helper `parseLocalYmd(value: string): Date | undefined` in `src/lib/date-utils.ts` (new file) that splits `YYYY-MM-DD` on `-` and constructs `new Date(y, m-1, d)` — giving local-midnight, never UTC. Returns `undefined` for empty/invalid input.
2. Use it in `src/components/training/TrainingSummarySection.tsx` for both the display `format(...)` call and the calendar's `selected` prop. Writes already use `format(date, 'yyyy-MM-dd')` and stay unchanged.
3. Add focused unit tests for `parseLocalYmd`:
   - Returns local-midnight Date for `'2026-05-22'` (asserts `getFullYear/getMonth/getDate`, not `toISOString`).
   - Returns `undefined` for `''`, `null`, `undefined`, and malformed strings.
   - Round-trip: `format(parseLocalYmd('2026-05-22'), 'yyyy-MM-dd') === '2026-05-22'`.

### Out of scope (will not touch)

- Autofill logic, autosave, sync, RLS, caching, photos, report generation.
- Other date pickers (Inspection / Daily Assessment) — only the reported Training Submission Date is affected here.
- Stored data format — remains `YYYY-MM-DD`.

### Validation

- Manual: in America/Chicago, open a blank training summary on May 22 → date shows "May 22nd, 2026". Pick May 19 → shows "May 19th, 2026". Reload → still correct.
- Tests: new `parseLocalYmd` suite passes; existing 1049 tests remain green.
