

## Remove the "Share" Button from the HTML Report Viewer

### What Changes

The "Share" button (using the Web Share API) will be removed from the report viewer toolbar. The remaining buttons — Email, Text (SMS), Download, and Close — stay as they are.

### File to Change

**`src/components/HtmlReportViewer.tsx`**

- Remove the `canShare` variable (`const canShare = canShareHtml()`)
- Remove the `handleShare` function
- Remove the `Share2` icon from the lucide-react import
- Remove the `canShareHtml` import from `@/lib/html-report-viewer`
- Remove the conditional block that renders the Share button:
  ```tsx
  {canShare && (
    <Button variant="outline" size="sm" onClick={handleShare} className="gap-2">
      <Share2 className="h-4 w-4" />
      <span className="hidden sm:inline">Share</span>
    </Button>
  )}
  ```

No other files are affected. The `shareHtmlReport` and `canShareHtml` exports in `src/lib/html-report-viewer.ts` can remain in place as utility functions (they are not used elsewhere, but removing them is optional cleanup).

