

## Ensure All Photos Render in PDF Reports (All Report Types)

### Problem
Two gaps exist in the PDF generators that cause missing or broken photos:

1. **Inspection PDF (`generate-inspection-pdf/index.ts`)**: Has zero photo handling. The HTML generator downloads and embeds inspection photos, but the PDF generator skips them entirely. Any inspection with photos will produce a PDF missing all images.

2. **Training PDF (`generate-training-pdf/index.ts`)**: Downloads and embeds photos, but lacks HEIC magic-byte detection. If a photo file has HEIC data disguised with a `.jpg` extension, `doc.addImage()` will either crash or render a black box. The HTML generators for both Inspection and Training already have this guard.

### Changes

| File | What |
|------|------|
| `generate-inspection-pdf/index.ts` | Add full photo section: fetch `inspection_photos`, download from private `inspection-photos` bucket, detect/skip HEIC, parse JPEG dimensions, add images with `checkPageBreak`, render captions |
| `generate-training-pdf/index.ts` | Add HEIC magic-byte detection before `addImage` — skip mislabeled files with a console warning, matching the pattern used in `generate-training-html` |

### Technical Detail

**1. Inspection PDF — Add photo section** (insert after Summary, before Disclaimer):
- Fetch `inspection_photos` in the parallel data query at the top (add to `Promise.all`)
- After the Summary section, if photos exist:
  - `doc.addPage()`, render "Inspection Photos" header
  - Loop through photos: download from `inspection-photos` bucket, check HEIC magic bytes (skip if detected), parse JPEG SOF markers for dimensions, scale proportionally within 80x60mm bounding box, `checkPageBreak(imgHeight + 20)`, `doc.addImage()`, render caption
- This mirrors the existing training PDF photo logic plus the HEIC guard from the HTML generators

**2. Training PDF — Add HEIC guard**:
- After downloading photo bytes and before the SOF dimension parsing, add the same magic-byte check used in `generate-training-html`:
  ```
  if bytes[4:8] == "ftyp" and bytes[8:12] in {heic, heis, mif1} → skip photo
  ```
- Log a warning and `continue` to the next photo

**3. Deploy both edge functions**

### What This Fixes
- Inspection PDFs will now include all attached photos (currently zero are rendered)
- Training PDFs will no longer crash or show black boxes for mislabeled HEIC files
- Both generators will have consistent HEIC-safe photo handling matching the HTML generators

