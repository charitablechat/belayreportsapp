
# Fix: Inspection Report HTML Content Wrapping & Cutoff

## Root Cause Analysis

The inspection HTML report has several CSS rules that cause text to be cut off:

1. **`.page` uses `page-break-inside: avoid`** (line 498) -- when a page's content exceeds one printed page, the browser tries to keep it together, causing content to clip rather than flow to the next page
2. **`white-space: nowrap`** applied to result columns (equipment, ziplines, systems, standards) and `.info-label` -- prevents text from wrapping when content is longer than the cell width
3. **Ziplines table has 9 columns with fixed percentage widths** -- the comments column gets squeezed, truncating text
4. **`max-width: 400px` on `table td`** -- caps cell width, causing overflow in cells with long comments
5. **`overflow-x: hidden` on `html, body`** -- silently hides any content that bleeds past the viewport edge

## Changes

### File: `supabase/functions/generate-inspection-html/index.ts`

**1. Allow pages to break across printed pages**
- Change `.page` from `page-break-inside: avoid` to `page-break-inside: auto` (line 498)
- This lets long content flow naturally to the next page instead of being clipped

**2. Remove `white-space: nowrap` from table result columns**
- Lines 826-837: Remove the `white-space: nowrap` rule on equipment result, zipline result, systems result, and standards documentation columns
- Replace with `white-space: normal` and `word-wrap: break-word` so longer result text wraps

**3. Remove `white-space: nowrap` from `.info-label`**
- Line 659: Change to `white-space: normal` so long labels like "Previously Inspected by:" don't push the value off-screen

**4. Remove `max-width: 400px` cap on table cells**
- Lines 736 and 1085: Remove or increase the `max-width: 400px` constraint on `table td` that artificially limits cell width

**5. Add global text wrapping safety net**
- Add `word-wrap: break-word` and `overflow-wrap: break-word` to `body` to ensure no text element can overflow its container

**6. Fix ziplines table column widths**
- Widen the comments column and relax the fixed percentages so content isn't squeezed (the 9 columns only total ~76%, leaving the auto comments column too narrow for long text)

**7. Ensure `overflow-x: hidden` doesn't clip content in print**
- In the `@media print` section, override `overflow-x: hidden` with `overflow: visible` on `html, body`

### No other files change
- The `HtmlReportViewer.tsx` already injects mobile override styles; no changes needed there
- No database or migration changes

## What This Fixes
- Long comments in table cells will wrap instead of being cut off
- Info field labels and values won't overlap or truncate
- Pages with many table rows will flow across printed pages naturally
- Result text (e.g., "Pass with Provisions") will wrap in narrow columns
- PDF/print output will show all content without clipping
