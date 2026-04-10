

# Remove Grey Boxes from Training and Daily Assessment Reports

## Problem
The Training and Daily Assessment HTML reports use a "card" aesthetic with bordered boxes, background fills, and rounded corners for info items and list items. The Inspection report uses a clean, professional document style with no backgrounds, dotted underlines, and a serif font. The user wants all reports to match the Inspection report's clean look.

Additionally, existing cached reports will continue showing the old grey-box style until regenerated with `forceRegenerate`.

## What Changes

### 1. Training Report (`supabase/functions/generate-training-html/index.ts`)

Restyle to match the inspection report's professional document aesthetic:

- **Font**: Switch from `Segoe UI` (sans-serif) to `Georgia, 'Times New Roman', serif`
- **`.info-item`**: Remove `background`, `border`, `border-radius`. Use `padding: 0; border: none;` with flexbox baseline alignment and dotted underline on values — matching `.info-cell` in the inspection report
- **`li`**: Remove `background: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px`. Use transparent background
- **`.info-label`**: Change color from `#1e40af` to `#000`, match inspection sizing
- **`.info-value`**: Add `border-bottom: 1px dotted #666` underline style
- **`.text-content`**: Change `background: #f8fafc` to `transparent`, use `border: 1px solid #000`
- **`.standards-box`**: Remove blue tinted background, use transparent with solid border
- **Section titles (h2)**: Keep blue background header bar (matches inspection `h2` style)

### 2. Daily Assessment Report (`supabase/functions/generate-daily-assessment-html/index.ts`)

Apply the same restyling:

- **Font**: Switch to `Georgia, 'Times New Roman', serif`
- **`.info-item`**: Remove card styling, use clean layout with dotted underlines
- **`li` / checklist items**: Remove background fills and card borders
- **`.check-item`**: Remove `background: #ffffff; border: 1px solid #e2e8f0; border-left: 3px solid #22c55e`. Use cleaner styling
- Keep the warning-yellow section notes as-is (they serve a distinct purpose)

### 3. Cache Bust

Both edge functions have server-side caching that returns `latest_report_html` if data hasn't changed. After deploying these style changes, users will need to click "Generate Report" (which triggers `forceRegenerate`) to see the new styling. No code change needed for this — it's the existing behavior.

## Files to Edit
- `supabase/functions/generate-training-html/index.ts` — CSS section (~lines 157-742)
- `supabase/functions/generate-daily-assessment-html/index.ts` — CSS section

## Result
All three report types will share the same clean, professional document aesthetic: serif font, no grey/colored boxes around info fields, dotted underlines for values, transparent backgrounds, and solid thin borders where needed.

