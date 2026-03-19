

## Fix Image Format Detection and PNG Support in PDF Generators

### Problem
Both PDF generators (`generate-inspection-pdf` and `generate-training-pdf`) have a critical gap: they **hardcode `'JPEG'` format** in every `doc.addImage()` call and only parse JPEG SOF markers for dimensions. If a user uploads a PNG photo, two things go wrong:

1. The JPEG SOF dimension parser finds nothing (returns 0x0), so the image defaults to 80x60mm — incorrect aspect ratio, potentially distorted
2. `doc.addImage(..., 'JPEG', ...)` on PNG binary data can produce a black box or crash on some renderers (especially Safari/Apple PDF viewers)

The HEIC guard is already in place and working correctly. The missing piece is **PNG format support**.

### Root Cause
The photo sections in both PDF generators assume all non-HEIC photos are JPEG. In reality, users can upload PNG files which have a completely different binary structure.

### Changes

| File | What |
|------|------|
| `generate-inspection-pdf/index.ts` | Add PNG magic-byte detection, PNG IHDR dimension parsing, and dynamic format selection in `addImage` |
| `generate-training-pdf/index.ts` | Same changes as above |

### Technical Detail

**1. Detect image format from magic bytes** (add before dimension parsing in both files):

```typescript
// Detect format: PNG starts with 89 50 4E 47, JPEG starts with FF D8
let imgFormat: 'JPEG' | 'PNG' = 'JPEG';
if (imgArray[0] === 0x89 && imgArray[1] === 0x50 &&
    imgArray[2] === 0x4E && imgArray[3] === 0x47) {
  imgFormat = 'PNG';
}
```

**2. Add PNG IHDR dimension parsing** (alongside existing JPEG SOF parsing):

PNG stores width and height as big-endian 32-bit integers at bytes 16-19 (width) and 20-23 (height) inside the IHDR chunk:

```typescript
if (imgFormat === 'PNG' && imgArray.length > 24) {
  jpegW = (imgArray[16] << 24) | (imgArray[17] << 16) |
          (imgArray[18] << 8)  | imgArray[19];
  jpegH = (imgArray[20] << 24) | (imgArray[21] << 16) |
          (imgArray[22] << 8)  | imgArray[23];
} else {
  // Existing JPEG SOF marker parsing...
}
```

**3. Use detected format in `addImage`**:

```typescript
// Before (hardcoded):
doc.addImage(`data:image/jpeg;base64,...`, 'JPEG', ...);

// After (dynamic):
const mimeType = imgFormat === 'PNG' ? 'image/png' : 'image/jpeg';
doc.addImage(`data:${mimeType};base64,...`, imgFormat, ...);
```

**4. Deploy both edge functions**

### What This Fixes
- PNG photos will render correctly with proper aspect ratios instead of black boxes or distorted 80x60mm defaults
- JPEG photos continue working as before
- HEIC guard remains unchanged — mislabeled HEIC files are still skipped
- Consistent behavior across Apple and non-Apple devices

