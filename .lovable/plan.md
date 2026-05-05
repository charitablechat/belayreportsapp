## Problem

Even after the previous tightening pass, blue `<h2>` headers are still landing partway down a PDF page (visible in the Solid Rock Camps PDF: "INSPECTION RESULTS KEY", "ACCT OPERATIONS STANDARDS", and the second table batch under "SYSTEMS - OPERATING SYSTEMS"). The current `page-break-after: avoid` / `page-break-inside: avoid` rule on `h2` only prevents the header itself from being split — it does not push the header to a new page when it would otherwise begin mid-sheet.

## Fix

Apply a single universal CSS rule in each of the 3 HTML/PDF generators: every `<h2>` starts a fresh printed page. Acceptable trade-off per user — "some white space is okay, too much white space is not" — and matches the request exactly: "If they fall in the middle of a page, I want them to start on a new page instead."

### Files to change

1. **`supabase/functions/generate-inspection-html/index.ts`** (around the existing `h2 { ... }` block at ~line 618):
   ```css
   h2 {
     /* existing styling */
     page-break-before: always;
     break-before: page;
     page-break-after: avoid;
     break-after: avoid;
     page-break-inside: avoid;
     break-inside: avoid;
   }
   /* Suppress the forced break on the very first h2 of the document
      so we don't get a blank leading page. */
   .page:first-of-type h2:first-of-type,
   .page-content > h2:first-child {
     page-break-before: auto;
     break-before: auto;
   }
   ```

2. **`supabase/functions/generate-training-html/index.ts`** — same rule appended to its style block.

3. **`supabase/functions/generate-daily-assessment-html/index.ts`** — same rule appended.

### Side-effects considered

- Pages that intentionally combine two h2 sections (e.g. `REMINDERS AND REQUIREMENTS` + `INSPECTION CATEGORIES` on page 2 of inspection reports) will now split into two pages. This is consistent with the rule the user asked for and removes the current orphan-header problem everywhere with one change.
- The `:first-child` override ensures the very first heading per page-wrapper does not introduce an extra blank page in front of itself.
- Existing `h2.new-page-section` and the `canCombineEquipmentStandards = false` change from the previous pass remain compatible (no-ops under the stronger universal rule).

### Deploy + verify

After edits, deploy the 3 edge functions and regenerate the Solid Rock Camps inspection PDF. Confirm:
- "INSPECTION RESULTS KEY", "SYSTEMS - OPERATING SYSTEMS" (each table batch), "ACCT OPERATIONS STANDARDS", "EQUIPMENT INSPECTION", "INSPECTION SUMMARY", "INSPECTION PHOTOS" all appear at the top of a printed page.
- No blank leading page.
- Training and Daily Assessment PDFs still render normally.
