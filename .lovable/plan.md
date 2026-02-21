

## Add "Download as PDF" Button to Generated HTML Report

### What Changes

Add a floating "Download as PDF" button directly into the generated HTML report that triggers the browser's native `window.print()` (Save as PDF). The button will be hidden from print/PDF output using `@media print { display: none }`.

### File: `supabase/functions/generate-inspection-html/index.ts`

**1. Add CSS for the button (in the existing `<style>` block)**

- A `.download-pdf-btn` class: fixed position at top-right, styled professionally (clean background, subtle shadow, border-radius), with a print icon or download icon
- Inside `@media print`: `.download-pdf-btn { display: none !important; }` so it never appears in the PDF output

**2. Add the button HTML (just before `</body>`)**

- Insert a button element with `onclick="window.print()"` right before the closing `</body>` tag (around line 2627)
- The button will say "Save as PDF" with a small download/print icon (inline SVG)

### Why It Works

- `window.print()` triggers the browser's native print dialog, which includes "Save as PDF" on all modern browsers
- The `@media print { display: none }` rule guarantees the button is invisible in the PDF output
- This works whether the report is viewed in the in-app viewer, opened in a new tab, or accessed via the signed storage URL directly

### No changes to

- Report data logic, photo encoding, or timeout settings
- `HtmlReportViewer.tsx` (the existing toolbar "Save PDF" button remains as-is)
- Any other edge functions
