

# Fix Excessive Whitespace in Generated PDF Reports

## Problem
All three report types use a `<div class="page">` structure with `page-break-after: always`, giving every section its own full page. Short sections (e.g., 5 bullet points, a small disclaimer, or a few checklist items) leave half or more of the page blank.

## Root Causes Identified

1. **Training Report** has 7 fixed pages regardless of content volume:
   - Page 3 (Verifiable Items) and Page 4 (Systems in Place) are often half-empty
   - Page 7 (Disclaimer/Submission) has only 2-3 fields and a disclaimer box — the rest is whitespace

2. **Inspection Report** has 4 mandatory intro pages that are always separate:
   - Page 2 (Reminders: 5 bullets) and Page 3 (Categories: 4 boxes) are short and could fit on one page
   
3. **All Reports** use generous spacing values designed for screen display that carry into print:
   - `margin-bottom: 25px` on sections, `gap: 18px 30px` on info grids, `margin-top: 30px` on footers
   - Print `@page` margins of 0.4-0.5in are wider than needed

## Solution

### 1. Training Report — Merge sparse pages
**File: `supabase/functions/generate-training-html/index.ts`**

- Combine Page 3 (Verifiable Items) and Page 4 (Systems in Place) into a single page. Both are checklist-style content that fits comfortably together.
- Combine Page 7 (Submission/Disclaimer) with the Summary page (Page 5) or the Photos page when photos exist. The submission section is only 2 info items + disclaimer text.
- Result: 5-6 pages instead of 7, with no wasted half-pages.

### 2. Inspection Report — Merge intro pages
**File: `supabase/functions/generate-inspection-html/index.ts`**

- Combine Page 2 (Reminders and Requirements) and Page 3 (Inspection Categories) into a single page. Together they fill roughly 80% of a letter page.
- Re-number subsequent pages accordingly.

### 3. Tighten print spacing across all three reports
**Files: All three HTML generators + `_shared/report-layout.ts`**

Reduce spacing values that apply during print/PDF:
- Section margins: `25px → 14px`
- Info grid gaps: `18px 30px → 10px 20px`
- Footer `margin-top`: `30px → 12px`
- Section title padding: `12px 20px → 8px 14px`
- `@page` margins: `0.5in → 0.35in` side margins
- Page content padding: `0.25in → 0.15in`
- Section title bottom margin: `15px → 8px`
- Footer disclaimer line-height: `1.5 → 1.3`
- Standards box / info-item padding: `15px → 10px`

These reductions apply in `@media print` blocks so the screen HTML view remains unchanged.

### 4. Daily Assessment — Minor tightening only
**File: `supabase/functions/generate-daily-assessment-html/index.ts`**

This report already has dynamic page merging. Apply only the spacing tightening from step 3 — no structural page merging needed.

## Files Changed
- `supabase/functions/generate-training-html/index.ts` — merge pages 3+4, merge disclaimer into last content page, tighten print spacing
- `supabase/functions/generate-inspection-html/index.ts` — merge pages 2+3, tighten print spacing
- `supabase/functions/generate-daily-assessment-html/index.ts` — tighten print spacing only
- `supabase/functions/_shared/report-layout.ts` — reduce shared footer/header spacing for print

## Expected Outcome
- Training reports: ~2 fewer pages, no half-empty pages
- Inspection reports: ~1 fewer page, denser intro section
- All reports: ~15-20% less vertical whitespace per page from tighter spacing
- Screen HTML view is unchanged — only print/PDF output is affected
- Professional appearance maintained with balanced content density

