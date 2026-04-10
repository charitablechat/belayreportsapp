

# Remove Remaining Grey/Colored Boxes from Training and Daily Assessment Reports

## Root Cause
While the main CSS classes were updated to transparent backgrounds, several elements still produce grey/colored boxes:

### Training Report (`generate-training-html/index.ts`)
1. **Photo cards (inline styles, ~line 970-974)**: `border: 1px solid #e2e8f0; border-radius: 8px;` on wrapper, `background: #f1f5f9;` on img, `background: #f8fafc;` on caption div — these are hardcoded inline styles that override any CSS
2. **Disclaimer block (CSS ~line 434-450)**: Yellow box with `background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px`
3. **Page container (CSS ~line 200)**: `box-shadow: 0 2px 10px rgba(0,0,0,0.1)` creates a grey shadow effect around each page
4. **Immediate attention items (~line 836)**: Inline `style="border-left-color: #dc2626;"` on `<li>` elements

### Daily Assessment Report (`generate-daily-assessment-html/index.ts`)
1. **Disclaimer block (CSS ~line 505-524)**: Same yellow box styling
2. **Section notes (CSS ~line 527-567)**: `background: #fffbeb`, `.notes-content` has `background: #fef3c7; border-left: 3px solid #f59e0b; border-radius: 4px/6px`
3. **Page container (CSS ~line 245)**: Same `box-shadow`

## Changes

### Training Report
- **Page**: Remove `box-shadow` from `.page`
- **Disclaimer**: Change to match inspection's clean style — transparent background, no colored border-left, no border-radius. Use simple `font-style: italic; color: #666; font-size: 8pt;`
- **Photo cards**: Remove inline `border-radius: 8px`, `background: #f1f5f9` on img, and `background: #f8fafc` on caption. Use clean `border: 1px solid #000` to match inspection's photo-item style
- **Immediate attention**: Remove inline `border-left-color` style from `<li>` elements

### Daily Assessment Report
- **Page**: Remove `box-shadow`
- **Disclaimer**: Same clean restyle as training
- **Section notes**: Remove `background: #fffbeb` and `background: #fef3c7`. Use transparent background with simple `border: 1px solid #000` border, no border-radius

## Files to Edit
- `supabase/functions/generate-training-html/index.ts` — CSS + inline HTML styles
- `supabase/functions/generate-daily-assessment-html/index.ts` — CSS

## After Deployment
Both edge functions will be deployed. Existing cached reports require clicking "Generate Report" (forceRegenerate) to pick up the new styling.

