

# Update PDF Filename Convention to Use Underscores

## What's Changing

The naming convention in `formatReportFilename` currently produces:
```
Acme Corp 04-2026.pdf
```

The requested convention produces:
```
Acme_Corp_04_2026.pdf
```

This is a **single-line change** in `src/lib/report-naming.ts`. The function is already used consistently across all report types (Inspection, Training, Daily Assessment) and all output paths (HTML viewer iframe title, PDF downloads, JSON exports). The `HtmlReportViewer` and `html-report-viewer.ts` already inject the filename into the `<title>` tag, so the browser's Save PDF dialog will automatically pick up the new format on all platforms.

## Change

**`src/lib/report-naming.ts`**

1. Update the return format from `${org} ${MM}-${YYYY}` to `${org}_${MM}_${YYYY}`
2. Update `sanitizeForFilename` to also replace spaces with underscores (so "Acme Corp" becomes "Acme_Corp")
3. Update the JSDoc comments to reflect the new convention

No other files need changes — all call sites already use `formatReportFilename`.

