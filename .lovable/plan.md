

## Remove Redundant "Save as PDF" Button from Generated HTML Report

### What Changes

Remove the floating "Save as PDF" button that was injected into the generated HTML report content itself. The toolbar already has a "Save PDF" button, making the in-report button redundant.

### File: `supabase/functions/generate-inspection-html/index.ts`

**1. Remove the CSS (lines 1541-1574)**

Delete the `.download-pdf-btn`, `.download-pdf-btn:hover`, `.download-pdf-btn:active`, and `.download-pdf-btn svg` style rules.

Also remove the `.download-pdf-btn` rule inside the existing `@media print` block (lines 1576-1579) -- only the download-pdf-btn portion, keeping the rest of the print media styles intact (photo-gallery rules, etc.).

**2. Remove the button HTML (lines 2665-2668)**

Delete the `<button class="download-pdf-btn">` element just before `</body>`.

### Deployment

Redeploy the `generate-inspection-html` edge function after the changes.

### No other changes needed

The toolbar "Save PDF" button in `HtmlReportViewer.tsx` remains as the single control for PDF generation.

