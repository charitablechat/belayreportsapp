

# Allow Photo Lightbox Viewing in Locked Reports

## Problem
In a completed (locked) report, clicking a photo thumbnail in `ItemPhotoUpload` is blocked by the `handleLockedFieldClick` interceptor because it uses `<button>` elements. The lock treats all button clicks as edit attempts and shows the "REPORT LOCKED" dialog instead of opening the lightbox.

The `PhotoGallery` lightbox itself (navigation arrows, close button) renders via a Dialog portal outside the locked `<main>` container, so it already works once opened. The issue is purely about **opening** the lightbox from item photo thumbnails.

## Changes

### 1. Mark lightbox-trigger elements as safe (`ItemPhotoUpload.tsx`)
Add `data-lightbox-trigger` attribute to the two `<button>` elements that open the lightbox (lines 346 and 365):
```tsx
<button data-lightbox-trigger type="button" onClick={() => setLightboxOpen(true)} ...>
```

### 2. Exclude lightbox triggers from lock interception (all three form files)
Update `handleLockedFieldClick` in `InspectionForm.tsx`, `TrainingForm.tsx`, and `DailyAssessmentForm.tsx` to skip elements marked with `data-lightbox-trigger`:

```ts
const isLightboxTrigger = target.closest('[data-lightbox-trigger]');
if (!isEditable || isTabTrigger || isLightboxTrigger) return;
```

This is the minimal change — one attribute on the thumbnail buttons, one condition in the lock handler. No structural changes needed since the lightbox Dialog already renders outside the locked container.

### Files Modified
- `src/components/inspection/ItemPhotoUpload.tsx` — add `data-lightbox-trigger` to thumbnail buttons
- `src/pages/InspectionForm.tsx` — exclude `[data-lightbox-trigger]` from lock
- `src/pages/TrainingForm.tsx` — same
- `src/pages/DailyAssessmentForm.tsx` — same

