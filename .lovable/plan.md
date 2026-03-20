

## Fix: Allow Both Camera Capture and File Upload

### Problem
The current `<input>` has `capture="environment"`, which on mobile devices forces the camera to open directly — users cannot browse their photo library or local files. On desktop, this attribute is ignored but there's still only one input path.

### Solution
Replace the single camera button with two options:
1. **Camera button** — uses `capture="environment"` for taking a photo (mobile)
2. **Upload button** — no `capture` attribute, opens the standard file picker (both desktop and mobile)

### Changes

**File: `src/components/inspection/ItemPhotoUpload.tsx`**

- Add a second hidden `<input type="file" accept="image/*">` without the `capture` attribute
- Add a second ref (`fileUploadRef`) for the browse input
- When no photo exists: show two small buttons side-by-side (Camera icon + Upload/Image icon) instead of one large button
- When replacing from the lightbox: show "Take Photo" and "Upload File" as two separate buttons instead of one "Replace"
- Both inputs share the same `handleFileChange` handler
- Import `ImagePlus` (or `Upload`) icon from lucide-react for the upload button

**Visual layout (no photo state):**
```text
┌────┐ ┌────┐
│ 📷 │ │ 📁 │   Two 10x10 (or 12x12) buttons side by side
└────┘ └────┘
```

**Lightbox replacement buttons:**
```text
[ 📷 Take Photo ] [ 📁 Upload ] [ ✕ Remove ]
```

### No other files changed
No database, storage, or other component changes needed.

