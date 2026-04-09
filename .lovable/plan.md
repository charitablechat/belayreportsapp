

# Standardize Report Viewer to "Save PDF" + "Close" Only

## Why Josh Sees Extra Buttons But You Don't

It's a **platform detection difference**, not a permissions issue. The viewer conditionally renders buttons based on `isMobile()` / `isPWA()`:

- **Desktop browser** (your setup): Shows only "Save PDF" and "Close" — the SMS "Text" button is hidden (`canShareViaSms()` returns false), and the mobile "Save PDF" / "Share" button pair collapses to just "Save PDF".
- **Mobile or PWA** (Josh's setup): Shows up to 4 extra buttons — "Share Link" (if reportId passed), "Text" (SMS), a mobile-only "Save PDF", and a "Share" button with the Share2 icon. Josh is likely accessing via mobile browser or the installed PWA.

No role/admin logic is involved — it's purely device-based conditional rendering.

## Changes

### `src/components/HtmlReportViewer.tsx`

1. **Remove the "Share Link" button** (lines 236-247) — the `Link2` / `copyShareLink` block
2. **Remove the "Text" SMS button** (lines 250-261) — the `MessageSquare` block
3. **Remove the mobile-only "Save PDF" button** (lines 263-272) — the `md:hidden` duplicate
4. **Simplify the remaining download button** — remove the mobile/desktop conditional icon swap. Always show `Download` icon with "Save PDF" label, always call `handleSavePdf` (which uses `printFromIframe` to trigger the browser's native print-to-PDF on the full iframe content)
5. **Clean up unused imports and variables** — remove `Share2`, `MessageSquare`, `Link2`, `canShareViaSms`, `generateSmsLink`, `shareHtmlReport`, `copyShareLink`, `useNetworkStatus`, `isMobile`, `isPWA`, and the `isMobileOrPWA`/`canSms`/`smsLink` variables
6. **Remove unused props** — remove `reportType`, `organization`, `date`, `reportId` from the interface (and from all 3 call sites in InspectionForm, TrainingForm, DailyAssessmentForm)

### PDF completeness

The `printFromIframe` function calls `iframe.contentWindow.print()` which invokes the browser's native print dialog on the full iframe document. This already captures the entire report. The `sandbox` attribute on the iframe currently lacks `allow-scripts` — I'll add `allow-modals` is already there, but the print dialog requires the iframe to be allowed to trigger it. I'll verify the sandbox value is correct for print to work reliably.

### Files touched
- `src/components/HtmlReportViewer.tsx` — simplify to 2 buttons
- `src/pages/InspectionForm.tsx` — remove extra props from `<HtmlReportViewer>`
- `src/pages/TrainingForm.tsx` — same
- `src/pages/DailyAssessmentForm.tsx` — same
- `src/lib/html-report-viewer.ts` — remove `generateSmsLink`, `canShareViaSms`, `shareHtmlReport` exports (dead code)

