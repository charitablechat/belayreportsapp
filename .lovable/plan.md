## Problem

The PDF reports use logical sections wrapped in `<div class="page">`, each containing its own in-page header (logos + title) and footer (disclaimer). My previous "tighten whitespace" change switched `page-break-after: always` → `auto` on `.page` to kill a trailing blank sheet. That had a side effect: multiple `.page` blocks now flow onto the same physical sheet, so:

- Section headers (logo bar) appear **mid-sheet** instead of at the top.
- Section footers (disclaimer) get pushed to the **top of the next sheet** with the rest blank.
- A new section starting near the bottom no longer moves to the next sheet.

This is visible in the uploaded `Solid_Rock_Camps_05_2026-5.pdf`.

## Fix

Treat each `<div class="page">` as exactly one physical sheet again — header at top, content middle, footer pinned to bottom — and solve the trailing-blank-page problem differently.

### 1. `supabase/functions/generate-inspection-html/index.ts` (and the matching changes in `generate-training-html` and `generate-daily-assessment-html`)

**Print CSS for `.page`:**
- Restore `page-break-after: always` (so a new logical section = new physical page; logo header is always at top of sheet).
- Keep `page-break-inside: auto` (long sections like big tables still flow across sheets, and the table-row break rules already in place handle that gracefully).
- Add `display: flex; flex-direction: column; min-height: 10.5in;` (letter height – `@page` margins) so the footer sits at the bottom of the sheet via `.page-content { flex: 1 1 auto }` and `.page-footer { margin-top: auto }`.
- Keep `.page:last-child { page-break-after: avoid }`.

**Header/footer:**
- `.page-header` stays at top (already first child).
- `.page-footer { margin-top: auto }` pushes it to the bottom of the flex column on each sheet.

### 2. Eliminate the trailing blank page without breaking pagination

Root cause of the prior blank trailing sheet was an empty `.page` block being emitted (or `page-break-after: always` on the last `.page` forcing an extra sheet). Two safeguards instead of disabling page breaks globally:

- Already have `.page:last-child { page-break-after: avoid }` — keep it and bump it to `!important` in print.
- In the HTML builders, audit the conditional sections so we never emit a `<div class="page">` whose `.page-content` has no rendered children (e.g. summary, standards, photos pages). Wrap each optional page in the same `if (hasContent)` guard already used elsewhere.

### 3. Long sections that genuinely need to span multiple sheets

When content inside one `.page` overflows a single sheet (e.g. a 50-row equipment table), the browser will paginate inside the section. Header/footer of that section will only appear on the first/last sheet of that span — that's expected and correct (same behavior as a Word document). Existing `thead { display: table-header-group }` already repeats column headers on continuation sheets.

## Files to edit

- `supabase/functions/generate-inspection-html/index.ts` (print `@media` block ~lines 1017–1050, plus any conditional `.page` emitters)
- `supabase/functions/generate-training-html/index.ts` (same two areas)
- `supabase/functions/generate-daily-assessment-html/index.ts` (same two areas)

## Verification

After deploying the three edge functions, regenerate the same Solid Rock Camps inspection PDF and confirm:

- Every logo header sits flush with the top margin of its sheet.
- Every disclaimer footer sits flush with the bottom margin of its sheet.
- No sheet has a footer at the top followed by blank space.
- No trailing blank sheet at the end of the document.
