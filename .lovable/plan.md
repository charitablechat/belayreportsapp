

# Photo Lightbox: Close Button and Back-Button Handling

## Changes

### 1. Add X close button to lightbox (PhotoGallery.tsx)
- Add a visible X button in the top-left corner of the lightbox overlay
- Style: white icon on semi-transparent dark circle, matching the existing nav arrow style (`bg-white/20 hover:bg-white/40 backdrop-blur-sm`)
- Clicking it calls `setSelectedPhotoIndex(null)`

### 2. Browser back button closes lightbox instead of leaving the report (PhotoGallery.tsx)
- When the lightbox opens, push a history state entry (`window.history.pushState({ lightbox: true }, '')`)
- Listen for `popstate` — if lightbox is open, close it and consume the event
- When lightbox closes normally (X button / overlay click / Escape), pop the extra history entry with `window.history.back()` only if we pushed one
- Use a ref to track whether we pushed a state, to avoid double-pops

### 3. Same treatment for ItemPhotoUpload.tsx lightbox
- Add X close button in top-left of the single-photo lightbox dialog
- Add the same pushState/popstate pattern so back button closes the lightbox rather than navigating away

## Files to modify
- `src/components/PhotoGallery.tsx`
- `src/components/inspection/ItemPhotoUpload.tsx`

