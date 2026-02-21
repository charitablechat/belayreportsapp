

## Fix: Save PDF on Mobile and Tablet Devices

### Problem

The "Save PDF" button calls `downloadHtmlReport()`, which opens a new browser tab via `window.open()` and then calls `window.print()`. This approach fails on mobile:

- **iOS Safari / PWA mode**: `window.open()` is blocked as a popup; `window.print()` is unsupported in standalone mode
- **Android Chrome**: The new-tab-then-print flow is unreliable and confusing for users
- Result: tapping "Save PDF" does nothing on phones and tablets

### Solution

Make the Save PDF button platform-aware:

- **Mobile / Tablet / PWA**: Use the **Web Share API** (already partially implemented in `shareHtmlReport`) to let users share/save the HTML report via the native share sheet. This works reliably on both iOS and Android.
- **If Web Share is unavailable**: Print directly from the **existing iframe** already rendered in the viewer dialog, avoiding the broken `window.open()` path entirely.
- **Desktop**: Keep the current `window.open()` + `print()` behavior (it works fine there).

### File Changes

**`src/lib/html-report-viewer.ts`**

- Add a new function `printFromIframe(iframe: HTMLIFrameElement)` that calls `iframe.contentWindow.print()` directly — no new window needed.
- This serves as the fallback when Web Share API is not available on mobile.

**`src/components/HtmlReportViewer.tsx`**

- Add a `ref` to the iframe element so we can access it for direct printing.
- Update the `handleDownload` function:
  1. If on mobile/PWA: try `shareHtmlReport()` first (native share sheet)
  2. If share fails or is unavailable: call `printFromIframe()` on the existing iframe ref
  3. If on desktop: keep existing `downloadHtmlReport()` behavior
- Update the button label to say "Share" on mobile and "Save PDF" on desktop for clarity.

### Technical Details

```
User taps "Save PDF" / "Share"
        |
        v
   Is mobile/PWA?
   /          \
  Yes          No
  |             |
  v             v
Try Web Share  window.open + print
  |             (existing behavior)
  |
Success? 
 / \
Y   N
|   |
v   v
Done  Print from
      existing iframe
```

### What the User Sees

- **On iPhone/iPad**: Tapping the button opens the native iOS share sheet, where they can "Save to Files", AirDrop, email, etc.
- **On Android**: Tapping the button opens the Android share dialog with similar options
- **On Desktop**: No change — same print dialog as before

