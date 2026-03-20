

## Layout & Rendering Audit: Findings and Fix Plan

### Audit Summary

Reviewed all three HTML report edge functions, the HtmlReportViewer component, and all form input tables (Equipment, OperatingSystems, Ziplines, Standards). The app-level React components are well-structured with responsive breakpoints and mobile card views -- no issues there.

The remaining gaps are in the **generated HTML reports** served inside the iframe viewer.

### Issues Found

**1. Daily Assessment report has ZERO mobile media queries**
The `generate-daily-assessment-html` edge function contains no `@media (max-width: ...)` rules at all. On mobile:
- `.info-grid` stays 2-column, cramping content
- `.info-item.full-width` uses `grid-column: span 2` which overflows on narrow screens
- `.systems-grid` stays 2-column with small, cramped system items
- Header stays as a horizontal flex row, logos can overlap the title
- No font-size reduction, no padding adjustments

**2. Training report photo grid uses inline styles the viewer selector may miss**
Line 846: `style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;"`. The viewer's attribute selector `[style*="grid-template-columns: 1fr 1fr"]` relies on exact whitespace matching. If the browser normalizes the inline style string differently, the selector fails silently. The training edge function's own `@media (max-width: 768px)` block does NOT override this inline grid.

**3. Training report missing `info-item` span fix**
The training `@media (max-width: 768px)` block collapses `.info-grid` to 1 column but doesn't add `.info-item { grid-column: span 1 }`. Any `info-item` with an explicit `span 2` would overflow. Currently training doesn't use `.full-width` but this is a latent bug if the template changes.

### Plan

**File 1: `supabase/functions/generate-daily-assessment-html/index.ts`**
Add a mobile media query block after the existing styles (before the `</style>` closing tag or before `@media print`). Include:
```css
@media (max-width: 768px) {
  html, body { max-width: 100vw; overflow-x: hidden; }
  body { padding: 8px; }
  .page { padding: 12px; }
  .page-header { flex-direction: column; text-align: center; gap: 8px; }
  .header-left, .header-right { text-align: center; }
  .page-title { font-size: 20px; }
  .info-grid { grid-template-columns: 1fr; gap: 8px; }
  .info-item.full-width { grid-column: span 1; }
  .systems-grid { grid-template-columns: 1fr; }
  .section-title { font-size: 12px; padding: 8px 12px; }
  .item-label, .item-comments, .notes-content {
    word-break: break-word;
    overflow-wrap: break-word;
  }
  .disclaimer { font-size: 11px; padding: 10px; }
}

@media (max-width: 480px) {
  body { padding: 4px; }
  .page { padding: 8px; }
  .page-title { font-size: 18px; }
}
```

**File 2: `supabase/functions/generate-training-html/index.ts`**
In the existing `@media (max-width: 768px)` block (line 537), add:
- `.info-item { grid-column: span 1 !important; }` to prevent future span overflow
- Add a class to the photo grid container instead of relying on inline styles. Change the inline `grid-template-columns: 1fr 1fr` div to include `class="photo-grid"` and add `.photo-grid { grid-template-columns: 1fr !important; }` in the 768px media query.

Also add `.text-content, .item-label { word-break: break-word; overflow-wrap: break-word; }` in the mobile block for long text safety.

**File 3: `src/components/HtmlReportViewer.tsx`**
No changes needed. The viewer already has comprehensive report-agnostic overrides that cover `.info-grid`, `.systems-grid`, `.info-item`, and text wrapping. Once the edge functions have their own mobile CSS, the viewer serves as a safety net.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/generate-daily-assessment-html/index.ts` | Add mobile media queries (768px + 480px) |
| `supabase/functions/generate-training-html/index.ts` | Add photo-grid class + mobile override, info-item span fix, text wrapping |

