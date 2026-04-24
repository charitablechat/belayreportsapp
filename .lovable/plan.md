## Context

The auto-populate logic for Next Inspection Date = Inspection Date + 1 year **already exists** in `src/pages/InspectionForm.tsx` (lines 206–253) and is wired into `SummarySection.tsx` via the `onNextDateUserEdit` callback. Both fields remain user-editable, and a manual override flag (`userTouchedNextDateRef`) prevents stomping the user's choice.

However, the screenshots reveal a real-world gap: an existing report shows **Inspection Date = April 24, 2026** and **Next Inspection Date = March 24, 2026** (before the inspection date — clearly stale data saved before this feature existed). The current initial-load check pins that legacy value as a "manual override," so it never auto-corrects.

## What to change

One small refinement to the initial-load detection in `InspectionForm.tsx`:

- If a saved `next_inspection_date` is **earlier than or equal to** the current `inspection_date`, treat it as stale (not a deliberate override) and let the auto-track effect overwrite it with `inspection_date + 1y`.
- Keep treating any `next_inspection_date` that is *after* `inspection_date` but doesn't equal `+1y` as a deliberate user override (e.g., 6-month or 2-year cycles).

That's the only behavioral change. Everything else — the +1y computation, the manual-edit flag, the SummarySection wiring, the timezone-safe date math via `parseLocalDate` / manual YYYY-MM-DD parsing — is already correct and stays as-is.

## Files touched

- `src/pages/InspectionForm.tsx` — adjust the initial-load `useEffect` (~lines 226–236) to compare dates and only pin the manual-override flag when the saved next-date is genuinely after the inspection date and differs from +1y.

## Verification

- New inspection: pick Inspection Date → Next Inspection Date auto-fills to +1 year. ✓ (already works)
- Edit Next Inspection Date manually → changing Inspection Date no longer overwrites it. ✓ (already works)
- Clear Next Inspection Date → auto-tracking resumes. ✓ (already works)
- Open a legacy report where next-date is before inspection-date → it now self-corrects to +1y on load. ← new behavior
- Open a report where user intentionally set next-date to 6 months out → preserved. ✓
