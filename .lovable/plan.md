

## Layout & Rendering Audit: Findings and Fix Plan

### Audit Summary

Reviewed all three HTML report generators (Inspection, Training, Daily Assessment), the HtmlReportViewer component, form input tables (Equipment, OperatingSystems, Ziplines), and dashboard components.

### Issues Found

**1. Training report photo gallery has no mobile responsive CSS**
The training photo grid (line 840) uses inline `grid-template-columns: 1fr 1fr` with no mobile override. On small screens, two columns of 200px-height images get cramped. The daily assessment has no photo gallery, so no issue there.

**2. Training report photo images lack `max-width: 100%` safety**
Photos use `width: 100%` but no `max-width` constraint on the container, so on very wide screens images could stretch beyond their natural size.

**3. Training & Daily Assessment `info-grid` `full-width` span breaks on mobile**
Both reports use `grid-column: span 2` for full-width items, but on mobile the grid becomes `1fr` (single column). `span 2` on a 1-column grid causes overflow. Need `grid-column: span 1` at mobile.

**4. Training report `systems-grid` (2-column) has no mobile override**
The `.systems-grid` in the daily assessment (line 456) uses `grid-template-columns: repeat(2, 1fr)` with no mobile fallback to single column.

**5. Inspection report: Ziplines table (11 columns) on mobile is extremely tight**
While `table-layout: auto` was applied, 11 columns at 7pt font is still very dense. The existing CSS is functional but could benefit from hiding low-priority columns on very small screens.

**6. HtmlReportViewer only injects mobile overrides for inspection-specific classes**
The viewer's injected `mobileBaseStyles` reference `.item-thumbnail`, `.photo-gallery`, and `.inspection-photo` — classes that only exist in inspection reports. Training and daily assessment reports get no viewer-side mobile help beyond the base `overflow-x: hidden`.

### Plan

**File 1: `supabase/functions/generate-training-html/index.ts`**
- Add mobile override in `@media (max-width: 600px)` block: photo grid → single column (`grid-template-columns: 1fr`)
- Fix `info-item` full-width span: add `grid-column: span 1 !important` at mobile to prevent 2-span on 1-column grid

**File 2: `supabase/functions/generate-daily-assessment-html/index.ts`**
- Add mobile override: `.systems-grid { grid-template-columns: 1fr }` at 768px breakpoint
- Fix `info-item.full-width` span at mobile: `grid-column: span 1`
- Add `word-break: break-word` to `.notes-content` and `.item-label` for long text

**File 3: `src/components/HtmlReportViewer.tsx`**
- Make injected `mobileBaseStyles` report-agnostic: add rules for `.info-grid`, `.systems-grid`, `.info-item`, and generic photo grid containers so training/daily assessment reports also benefit from viewer-side mobile fixes

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/generate-training-html/index.ts` | Mobile photo grid + info span fix |
| `supabase/functions/generate-daily-assessment-html/index.ts` | Mobile systems-grid + info span fix |
| `src/components/HtmlReportViewer.tsx` | Report-agnostic mobile overrides |

