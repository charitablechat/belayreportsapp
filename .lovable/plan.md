

## Fix Text and Image Wrapping on Mobile HTML/PDF Reports

### Problems Identified

**1. Tables have `min-width` forcing horizontal scroll on mobile**
In the edge function CSS at lines 1401-1403 and 1455-1458:
```css
table { min-width: 600px; } /* @media max-width: 768px */
table { min-width: 500px; } /* @media max-width: 480px */
```
This forces all tables to be wider than the viewport, requiring horizontal scrolling. The ziplines table with 11 columns is especially problematic.

**2. Item thumbnails are fixed 60×60px with no mobile override**
The `.item-thumbnail` class (lines 877-885) uses fixed `width: 60px; height: 60px` with no mobile media query to scale down. On small screens this wastes significant horizontal space.

**3. Photo gallery uses `max-width: 90%` center layout with no mobile override for the container**
The `photo-gallery` container (line 1536) is `max-width: 90%` which works on desktop but the mobile override at line 1521 sets `max-width: 95%` — this still clips on very small viewports.

**4. The HtmlReportViewer injects mobile styles that conflict with the edge function's embedded styles**
The viewer component injects its own `@media (max-width: 600px)` styles that override and sometimes conflict with the edge function's existing responsive CSS (e.g., both try to control `.page-header` direction, table sizing, etc.).

### Plan

**File 1: `supabase/functions/generate-inspection-html/index.ts`** — Fix edge function CSS

1. **Remove `min-width` from mobile table rules** — Delete `min-width: 600px` and `min-width: 500px` from the 768px and 480px media queries. Instead, let tables use `table-layout: auto; width: 100%` so content wraps naturally.

2. **Add mobile-responsive item thumbnails** — In the `@media (max-width: 768px)` block, scale thumbnails down:
   ```css
   .item-thumbnail { width: 40px; height: 40px; }
   ```
   At 480px:
   ```css
   .item-thumbnail { width: 30px; height: 30px; }
   ```

3. **Simplify ziplines table on mobile** — At 768px breakpoint, hide less critical columns (Cable Type, EAD System) with `display: none` and use nth-child selectors to collapse them. Or alternatively, reduce all column widths to `auto` and remove percentage-based widths.

4. **Fix photo gallery mobile** — Change `max-width: 95%` to `max-width: 100%` and ensure `padding: 0` on the container at mobile breakpoints.

5. **Consolidate mobile media queries** — The file has three overlapping mobile breakpoints (768px, 600px, 480px). Merge the 600px block into the 768px block to reduce conflicts and specificity wars.

**File 2: `src/components/HtmlReportViewer.tsx`** — Reduce injected style conflicts

1. **Remove duplicate mobile rules** that are already handled by the edge function's embedded CSS (header stacking, info-grid, table sizing). Keep only rules that are specific to the iframe viewer context (viewport overflow prevention, base reset).

2. **Add item-thumbnail mobile override** in the injected styles to ensure consistency:
   ```css
   .item-thumbnail { width: 40px !important; height: 40px !important; }
   ```

### Technical Details

The core fix is removing `min-width` on tables at mobile breakpoints. Currently the mobile CSS says "tables must be at least 600px wide, scroll horizontally" — but since the report is viewed inside an iframe in a dialog, horizontal scrolling creates a poor experience. Instead, let tables reflow naturally with `table-layout: auto` and smaller font sizes, which already exist.

For the ziplines table (11 columns), the content will be tight but readable at 7-8pt font with `word-break: break-word` on all cells — which is already set.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/generate-inspection-html/index.ts` | Remove min-width on tables, add thumbnail scaling, fix photo gallery, consolidate media queries |
| `src/components/HtmlReportViewer.tsx` | Remove conflicting duplicate rules, add thumbnail mobile override |

