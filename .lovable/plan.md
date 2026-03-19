

## Fix PDF Page Truncation — Orphaned Headers & Content Overflow

### Problem
Despite previous standardization of `checkPageBreak`, section headers (e.g., "Future Considerations", "Critical Actions Required") can still render at the very bottom of a page without their content, creating the appearance of missing content. Additionally, the disclaimer box text spacing calculation may undercount actual rendered height, causing text to overflow the yellow box.

### Root Cause
Several section sub-headers lack their own `checkPageBreak` call. The per-line `checkPageBreak(5)` inside loops catches individual lines but does NOT prevent a header from being orphaned at the page bottom. On Apple systems (Safari PDF viewer), this orphan effect is more visually apparent.

### Changes

**File: `supabase/functions/generate-inspection-pdf/index.ts`**

| Location | Fix |
|----------|-----|
| Summary → Critical Actions header (line ~517) | Add `checkPageBreak(20)` before the "Critical Actions Required" header to keep header + first line together |
| Summary → Repairs section (line ~534) | Add `checkPageBreak(15)` before starting repairs text block |
| Summary → Future Considerations header (line ~547) | Add `checkPageBreak(20)` before the "Future Considerations" header |
| Summary → Next Inspection table (line ~562) | Add `checkPageBreak(15)` before the autoTable call |
| Disclaimer text spacing (line ~600) | Increase line spacing from `4`mm to `4.5`mm to prevent text overflow below the yellow box; update `disclaimerHeight` calculation to match |

**File: `supabase/functions/generate-training-pdf/index.ts`**

| Location | Fix |
|----------|-----|
| Summary → Observations header (line ~448) | Add `checkPageBreak(20)` before "Training Observations" header |
| Summary → Recommendations header (line ~476) | Add `checkPageBreak(20)` before "Training Recommendations" header |
| Report Verification header (line ~504) | Already has `checkPageBreak(30)` — no change needed |
| Photo captions (line ~606) | Add `checkPageBreak(10)` before caption text to prevent caption rendering off-page |
| Disclaimer text spacing (line ~638) | Increase line spacing from `4`mm to `4.5`mm; update `disclaimerHeight` to `(lines.length * 4.5) + 16` |

### Summary of Pattern
Before every section header or sub-header, ensure `checkPageBreak(headerHeight + firstContentLineHeight)` is called to prevent orphaning. Fix disclaimer line spacing to prevent text overflowing its background box.

