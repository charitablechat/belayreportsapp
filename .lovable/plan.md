

## Add "Download as PDF" Button to Mobile Report Viewer

### What Changes

Add a dedicated "Download as PDF" button to the mobile action banner in `HtmlReportViewer.tsx`, alongside the existing "Share" and "Close" buttons. This button will directly trigger `printFromIframe` (the browser's native Save as PDF flow), separate from the Share button which uses the Web Share API.

### File: `src/components/HtmlReportViewer.tsx`

**1. Add a new `handleSavePdf` function** that directly calls `printFromIframe(iframeRef.current)` -- no Web Share API, just the native print dialog.

**2. Add a new button before the existing Share button (around line 311)**

- Visible on mobile only: `className="md:hidden"` (inverse of the hidden Email/SMS buttons)
- Hidden from print output: add `print:hidden` to the className (the parent div at line 282 already has `print:hidden`, providing double coverage)
- Uses `Download` icon with label "Save PDF"
- Calls `handleSavePdf` on click

**3. Button structure:**
```tsx
<Button
  variant="outline"
  size="sm"
  onClick={handleSavePdf}
  className="md:hidden gap-2 print:hidden"
  title="Download as PDF"
>
  <Download className="h-4 w-4" />
  <span className="hidden sm:inline">Save PDF</span>
</Button>
```

### Why It's Hidden from PDF

Two layers of protection:
1. The parent toolbar div already has `print:hidden` (Tailwind's `@media print { display: none }`)
2. The button itself also carries `print:hidden` for explicit safety

### No changes to
- Edge functions or report HTML generation
- The existing "Share" button behavior (Web Share API on mobile)
- The existing "Save PDF" button on desktop
- Any report data logic or timeout settings

