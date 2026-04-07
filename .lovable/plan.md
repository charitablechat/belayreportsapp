

# Refactor Report HTML: Remove Grey Box Styling, Apply Clean Professional Aesthetic

## Current Problem
All three report generators use a heavy grey (`#c2c2c2`) background on nearly every element — body, info items, list items, text blocks, table headers, and even alternating table rows. This creates a dated, muddy appearance. The screenshot confirms: info items are grey boxes with blue left borders, trainee names sit on a full-width grey slab.

## Design Direction
Clean, minimal professional report: white backgrounds, subtle borders, structured with typography and spacing rather than background fills. Single accent color: **#1e40af** (existing blue). Secondary accent for borders/dividers: **#e2e8f0** (light slate).

```text
BEFORE                          AFTER
┌──────────────────┐            ┌──────────────────┐
│ ▌█████ grey box  │            │  Label            │
│ ▌█████ grey box  │            │  Value            │
│ ▌█████ grey box  │            │  ─────────────── │
│ ▌█████ grey box  │            │  Label            │
└──────────────────┘            │  Value            │
                                └──────────────────┘
```

## Changes Per File

### 1. Training Report (`generate-training-html/index.ts`)

**Body:** `background: #c2c2c2` → `background: #ffffff`

**`.info-item`:** Remove grey bg + blue left border. Replace with:
- `background: #ffffff`
- `border: 1px solid #e2e8f0`
- `border-radius: 4px`
- `padding: 10px 12px`

**`.info-label`:** Darken to `color: #1e40af` (accent), `font-size: 11px`, `text-transform: uppercase`, `letter-spacing: 0.5px`

**Global `li`:** Remove `background: #c2c2c2` and `border-left: 3px solid #3b82f6`. Replace with:
- `background: #ffffff`
- `border: 1px solid #e2e8f0`
- `border-radius: 4px`
- Keep padding `8px 12px`

**`.text-content`:** `background: #c2c2c2` → `background: #f8fafc` (very light blue-grey), `border: 1px solid #e2e8f0`

**`.standards-box`:** Keep light blue `#dbeafe` bg — this is intentionally distinct and already looks clean.

**Photo grid items:** Already use `border: 1px solid #e2e8f0` — no change needed.

### 2. Inspection Report (`generate-inspection-html/index.ts`)

**`table th`:** `background: #c2c2c2` → `background: #1e40af`, `color: white` (already done in print CSS; apply to screen too for consistency)

**`.key-section`:** `background: #c2c2c2` → `background: #f8fafc`, `border: 1px solid #e2e8f0`

**`.info-grid` print:** Remove `background: #c2c2c2 !important`

**`table tr:nth-child(even)` print:** `background: #c2c2c2` → `background: #f8fafc`

**`.section-header` print:** `background-color: #c2c2c2` → `background-color: #f1f5f9`

**`.inspection-photo`:** `background: #c2c2c2` → `background: #f8fafc`

**`.section-divider`:** `border-top: 2px solid #c2c2c2` → `border-top: 1px solid #e2e8f0`

**`.info-cell` mobile border:** `border-bottom: 1px solid #c2c2c2` → `border-bottom: 1px solid #e2e8f0`

### 3. Daily Assessment Report (`generate-daily-assessment-html/index.ts`)

**Body:** `background: #c2c2c2` → `background: #ffffff`

**`.info-item`:** Same treatment as training — white bg, subtle border, no grey.

**Global `li`:** Same — remove grey bg, add white bg with light border. Keep `.checked` (green left border) and `.unchecked` (red left border) accent colors but on white background.

**`.system-item`:** `background: #c2c2c2` → `background: #ffffff`, `border: 1px solid #e2e8f0`, keep green left border accent.

### 4. Shared Layout (`_shared/report-layout.ts`)

No changes needed — the shared layout only defines header/footer structure, not content backgrounds.

## Print CSS Adjustments
In all three generators' `@media print` blocks:
- Remove any `background: #c2c2c2 !important` overrides
- Replace with `background: #f8fafc !important` or `transparent` as appropriate
- Keep `print-color-adjust: exact` to preserve the subtle tints

## What Stays the Same
- Blue section title bars (`#1e40af` background, white text)
- Blue accent on header border-bottom
- Yellow disclaimer boxes (`#fef3c7`)
- Red critical/fail highlights
- Green/red checklist border accents
- Logo placement and sizing
- All typography, font families, and sizing
- Page structure and pagination logic

## Files Modified
- `supabase/functions/generate-training-html/index.ts`
- `supabase/functions/generate-inspection-html/index.ts`
- `supabase/functions/generate-daily-assessment-html/index.ts`

## Expected Outcome
Reports shift from a heavy grey-box aesthetic to a clean white-and-blue professional look. Content is distinguished by subtle borders and typography hierarchy rather than background fills. Consistent across all three report types.

