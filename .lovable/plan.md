

## Download Report as PDF

### Approach

Use the browser's built-in Print-to-PDF engine to convert the HTML report to a PDF download. This is the most reliable method because:

- No extra libraries needed (zero bundle size increase)
- The browser's rendering engine handles page breaks, margins, and layout perfectly
- The HTML reports already contain print-optimized CSS (`@media print` styles)

### How It Works

When the user clicks **Download**, a new browser window opens with the report HTML, automatically triggers the system Print dialog (which defaults to "Save as PDF" on most devices), and closes itself afterward. The user picks a save location and gets a proper `.pdf` file.

On mobile (iOS/Android), this opens the native share/print sheet which also offers "Save as PDF."

### Files to Change

**`src/lib/html-report-viewer.ts`**
- Replace the `downloadHtmlReport` function. Instead of creating and downloading an `.html` blob, it will:
  1. Open a new browser window
  2. Write the HTML content into it
  3. Wait for images/fonts to load
  4. Call `window.print()` (which opens the Save as PDF dialog)
  5. Close the window when printing is done or cancelled

**`src/components/HtmlReportViewer.tsx`**
- Update the Download button label from "Download" to "Save PDF" for clarity
- No logic changes needed since it already calls `downloadHtmlReport`

### No New Dependencies

This uses only built-in browser APIs (`window.open`, `window.print`). No npm packages to install.

