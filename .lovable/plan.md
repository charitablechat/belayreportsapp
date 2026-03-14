

## Improve Dashboard List View Readability

### Problem
The list view table rows are hard to read because the background (wood planks) bleeds through — the table lacks an opaque background. The header row and data rows have insufficient contrast against the textured background.

### Changes

**`src/components/dashboard/ReportListView.tsx`:**
- Add a solid opaque background to the outer container: `bg-background` on the wrapper div
- Add alternating row striping: even rows get `bg-muted/30` for visual separation
- Add a stronger header background: `bg-muted/80 backdrop-blur-sm` on the `TableHeader`
- Increase row padding slightly for breathing room
- Make the "Days" column badge more prominent for draft rows

**Specific styling updates:**
1. Wrapper div: `border rounded-md overflow-hidden` → `border rounded-md overflow-hidden bg-background/95 backdrop-blur-sm shadow-sm`
2. TableHeader: add `className="bg-muted/80"`
3. TableRow: add alternating stripe via index — even rows get `bg-muted/20`
4. Increase font weight on Title column for better scanability

These are CSS-only changes to the single `ReportListView.tsx` file. No logic or structural changes needed.

