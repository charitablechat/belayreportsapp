

## Disable the Email Button in the HTML Report Viewer

### Change

In `src/components/HtmlReportViewer.tsx`, the Email button (lines 262-273) will be changed from conditionally rendered and fully active to **always visible but permanently disabled and greyed out**.

### What Will Change

- Remove the `canEmail` conditional wrapper so the button always renders (when `reportType` is provided)
- Add `disabled` to the Button
- Replace the active styling with a muted/greyed-out appearance (`opacity-50 cursor-not-allowed`)
- Remove the `onClick` handler

The `EmailReportDialog` component and its related state/imports can remain for now (no functional impact since the button can't be clicked).

### File

**`src/components/HtmlReportViewer.tsx`** (lines 262-273)

```tsx
// BEFORE
{canEmail && (
  <Button
    variant="outline"
    size="sm"
    onClick={handleEmail}
    className="gap-2 border-2 border-foreground hover:bg-foreground hover:text-background transition-colors duration-100"
    title="Email Report"
  >
    <Mail className="h-4 w-4" />
    <span className="hidden sm:inline">Email</span>
  </Button>
)}

// AFTER
{Boolean(reportType) && (
  <Button
    variant="outline"
    size="sm"
    disabled
    className="gap-2 opacity-50 cursor-not-allowed"
    title="Email Report (coming soon)"
  >
    <Mail className="h-4 w-4" />
    <span className="hidden sm:inline">Email</span>
  </Button>
)}
```

No other files need changes.
