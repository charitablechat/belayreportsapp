

## Fix Incomplete PDF Generation on Apple Computers

### Problem
The server-side PDF generators (jsPDF in edge functions) produce PDFs with missing/truncated pages for long reports like "Twin Lakes" and "Girl Scouts." The root cause is **inconsistent page-break logic** — some sections use the `checkPageBreak` helper while others use older ad-hoc checks with varying margin thresholds (40mm, 60mm, 80mm), causing content to overflow past page boundaries.

### Root Cause Details

**Inspection PDF** has mixed patterns:
- `checkPageBreak(neededHeight)` with `footerZone = 30` (correct)
- `if (yPos > pageHeight - 80)` (old, inconsistent)
- `if (yPos > pageHeight - 40)` inline in text loops (old, inconsistent)
- `if (yPos > pageHeight - 60)` for disclaimer (old, inconsistent)

**Training PDF** has similar gaps:
- Photo section uses `if (yPos + imgHeight + 20 > pageHeight - 30)` instead of `checkPageBreak`
- Disclaimer uses `if (yPos > pageHeight - 60)` instead of `checkPageBreak`

When `autoTable` internally spans pages, subsequent `yPos` tracking can desync, causing content to render off-page.

### Changes

| File | What |
|------|------|
| `generate-inspection-pdf/index.ts` | Replace all old `if (yPos > pageHeight - N)` patterns with `checkPageBreak`; add `yPos` resync after every `autoTable` call |
| `generate-training-pdf/index.ts` | Standardize photo section and disclaimer to use `checkPageBreak`; add `yPos` resync after `autoTable` |

### Technical Detail

**1. Add autoTable yPos resync helper** (both files):
```typescript
// After every autoTable call, sync yPos to handle cross-page tables
const syncYPos = () => {
  const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
  yPos = doc.lastAutoTable.finalY + 10;
};
```

**2. Inspection PDF — standardize all page break checks**:
Replace every instance of:
```typescript
if (yPos > pageHeight - 80) { doc.addPage(); yPos = margin; }
if (yPos > pageHeight - 40) { doc.addPage(); yPos = margin; }
if (yPos > pageHeight - 60) { doc.addPage(); yPos = margin; }
```
With:
```typescript
checkPageBreak(neededHeight);  // using footerZone = 30 consistently
```

Specific locations:
- Course history text loop (line ~281): `checkPageBreak(5)` before each line
- Operating Systems section (line ~309): `checkPageBreak(30)` before header
- Ziplines section (line ~360): `checkPageBreak(30)` before header
- Equipment section (line ~415): `checkPageBreak(30)` before header
- Equipment categories (line ~436): `checkPageBreak(20)` before each category
- Summary critical/repairs/future text loops (lines ~547-589): `checkPageBreak(5)` before each line
- Disclaimer (line ~616): `checkPageBreak(disclaimerHeight + 10)`

**3. Training PDF — standardize remaining gaps**:
- Photo section (line ~597): Replace inline check with `checkPageBreak(imgHeight + 20)`
- Disclaimer (line ~628): Replace inline check with `checkPageBreak(disclaimerHeight + 10)`

**4. Deploy both updated edge functions**

