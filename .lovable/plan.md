

# Fix: Always Show Save PDF + Close Buttons on Reports

## Root Cause

All three form pages (InspectionForm, TrainingForm, DailyAssessmentForm) follow this pattern:

```typescript
const opened = openHtmlReport({ html, filename, title }); // opens raw window.open()
if (!opened) {
  // Only uses HtmlReportViewer (with buttons) as a FALLBACK
  setReportHtml(html);
  setHtmlViewerOpen(true);
}
```

When `window.open` succeeds (most desktop browsers), the report opens in a plain browser tab with zero UI controls — no Save PDF, no Close. The `HtmlReportViewer` component that has those buttons is only shown when the popup is blocked.

## Fix

**Always use the in-app `HtmlReportViewer`** — stop trying `openHtmlReport()` entirely.

### Files changed

**`src/pages/InspectionForm.tsx`** (~lines 2367-2376)
- Remove `openHtmlReport` call and conditional
- Always set `setReportHtml(html)` + `setHtmlViewerOpen(true)`
- Remove `openHtmlReport` import

**`src/pages/TrainingForm.tsx`** (same pattern, ~lines 1141-1145)
- Same change

**`src/pages/DailyAssessmentForm.tsx`** (same pattern, ~lines 1329-1333)
- Same change

**`src/lib/html-report-viewer.ts`**
- Remove `openHtmlReport` export (now dead code)

### Result
Every report generation will display inside the `HtmlReportViewer` dialog with the standardized Save PDF and Close buttons, on all devices, for all users.

