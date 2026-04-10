

# Fix PDF Save Filename Across All Platforms

## Problem
When clicking "Save PDF" in the report viewer, the browser's print-to-PDF dialog uses the iframe's `<title>` tag as the default filename. The edge functions set titles like "Inspection Report - Acme Corp" instead of the desired convention: **"Acme Corp 03-2024.pdf"**.

The `HtmlReportViewer` component already receives a correctly formatted `filename` prop (from `formatReportFilename`), but it never injects that into the iframe's HTML `<title>`. The browser ignores the `filename` prop entirely.

## Fix

### 1. `src/components/HtmlReportViewer.tsx` — Inject filename as `<title>`
In the `enhancedHtml` processing (where mobile styles are already injected before `</head>`), also replace the existing `<title>...</title>` with the `filename` prop (minus the extension). This ensures the browser print dialog pre-populates with the correct name on all platforms.

```typescript
// Strip extension for the PDF save dialog title
const pdfTitle = filename.replace(/\.\w+$/, '');
// Replace existing <title> or inject before </head>
let enhancedHtml = html.replace(/<title>[^<]*<\/title>/, `<title>${pdfTitle}</title>`);
// Then inject mobile styles as before
enhancedHtml = enhancedHtml.replace('</head>', `${mobileBaseStyles}</head>`);
```

This single change ensures that when the user clicks "Save PDF" on **any platform** (Web, iOS, Android, Windows, macOS), the print dialog suggests **"Acme Corp 03-2024"** as the filename.

### 2. `src/lib/html-report-viewer.ts` — Same fix for `downloadHtmlReport`
The fallback `downloadHtmlReport` function (used when popup-based printing is triggered) also opens a new window. Apply the same `<title>` replacement using the `_filename` parameter (currently unused — hence the underscore prefix).

## Files Changed
1. `src/components/HtmlReportViewer.tsx` — Replace `<title>` with filename before rendering in iframe
2. `src/lib/html-report-viewer.ts` — Use the `filename` parameter to set `<title>` in the print window

