

# Fix: Table Text Wrapping in HTML Report Viewer

## Problem

On mobile, tables with many columns (Operating Systems: 5 cols, Equipment: 6 cols, Ziplines: 11 cols) are being squeezed to fit 100% viewport width. This causes every word to wrap onto its own line, making the report unreadable. The screenshots show "Pass with Provisions" breaking into 6+ lines, column headers splitting letter-by-letter.

## Root Cause

Two layers of CSS both force `table { width: 100%; max-width: 100% }` and `td, th { width: auto !important }` on mobile:

1. **`generate-inspection-html/index.ts`** (lines 1474-1478): Sets `table { width: 100%; max-width: 100% }` in the `@media (max-width: 768px)` block
2. **`HtmlReportViewer.tsx`** (lines 112-119): Injects additional `width: auto !important` overrides on all table cells

The `table-wrapper` has `overflow-x: auto` but is useless since the table itself is capped at 100% width.

## Fix

Allow tables to exceed viewport width and scroll horizontally inside their `.table-wrapper` container, with sensible minimum widths per table type.

### File 1: `supabase/functions/generate-inspection-html/index.ts`

In the `@media (max-width: 768px)` block (~lines 1474-1479):
- Remove `width: 100%; max-width: 100%` from the `table` rule
- Add minimum widths per table class:
  - `.systems-table { min-width: 600px }`
  - `.equipment-table { min-width: 550px }`
  - `.ziplines-table { min-width: 900px }`
  - `.standards-table { min-width: 500px }`
- Keep `table-layout: auto` and `font-size: 8pt`

In the `@media (max-width: 480px)` block (~lines 1565-1569):
- Same: remove `width: 100%` from the `table` rule

### File 2: `src/components/HtmlReportViewer.tsx`

In the injected mobile styles (~lines 112-119):
- Remove the blanket `width: auto !important` override on all table cells — this was fighting the column width percentages set by the HTML generator
- Keep `min-width: 0 !important` to remove fixed min-widths

Add table min-widths in the viewer's mobile styles to match (same values as above), ensuring the tables scroll inside the iframe.

### File 3: `supabase/functions/generate-inspection-html/index.ts` (redeploy)

The edge function must be redeployed for the fix to apply to newly generated reports. Existing cached reports will benefit from the HtmlReportViewer.tsx changes only.

## Result

- **Mobile**: Tables maintain readable column widths and users can horizontally scroll to see all columns. Text like "Pass with Provisions" stays on 1-2 lines max.
- **Tablet/Desktop**: No change — tables already fit comfortably at full width.
- **Print/PDF**: No change — print media queries are untouched.

