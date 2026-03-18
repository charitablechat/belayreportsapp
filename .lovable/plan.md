

## Fix Cropped Photos in Reports

### Problem
Two report generators crop photos:

1. **Training PDF** (`generate-training-pdf/index.ts` line 553-554): Forces all photos to a fixed 4:3 aspect ratio (`imgWidth * 0.75`), stretching/squashing images that don't match
2. **Training HTML** (`generate-training-html/index.ts` line 843): Uses `object-fit: cover` which crops images to fill the container, cutting off edges

The inspection HTML report already uses `object-fit: contain` correctly.

### Changes

| File | What | Why |
|------|------|-----|
| `supabase/functions/generate-training-pdf/index.ts` | Use `jsPDF`'s image properties to calculate actual aspect ratio from the image dimensions, cap at a small max size (e.g. 80mm wide, 60mm tall), and scale proportionally | Prevents distortion and cropping of non-4:3 photos |
| `supabase/functions/generate-training-html/index.ts` | Change `object-fit: cover` → `object-fit: contain` and set `height: auto; max-height: 200px;` on photo `<img>` tags | Shows the full image without cropping |

### Technical Detail

**Training PDF fix** (line 553-554):
```typescript
// Before: fixed ratio, crops non-4:3
const imgWidth = contentWidth * 0.6;
const imgHeight = imgWidth * 0.75;

// After: read actual dimensions, scale to fit within bounds
const maxW = 80; // mm
const maxH = 60; // mm
const props = doc.getImageProperties(`data:image/jpeg;base64,${imgBase64}`);
const ratio = Math.min(maxW / props.width, maxH / props.height);
const imgWidth = props.width * ratio;
const imgHeight = props.height * ratio;
```

**Training HTML fix** (line 843):
```html
<!-- Before: cover crops -->
<img style="width: 100%; height: 200px; object-fit: cover;" />

<!-- After: contain preserves -->
<img style="width: 100%; max-height: 200px; object-fit: contain; background: #f1f5f9;" />
```

