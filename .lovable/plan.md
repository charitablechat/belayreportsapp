

# Photo Gallery Lightbox Navigation

## Problem
When a photo is clicked to view full-size in the lightbox, users must close the viewer and click another photo to see it. There's no way to navigate between photos without leaving the lightbox.

## Solution
Add left/right arrow navigation to the existing lightbox dialog in `PhotoGallery.tsx`, allowing users to cycle through all photos sequentially.

## Changes — single file: `src/components/PhotoGallery.tsx`

1. **Track selected photo by index** instead of by object reference
   - Replace `selectedPhoto: Photo | null` state with `selectedPhotoIndex: number | null`
   - Derive the current photo from `photos[selectedPhotoIndex]`

2. **Add navigation handlers**
   - `goToPrev`: decrement index, wrap to last photo when at 0
   - `goToNext`: increment index, wrap to first photo when at end
   - Add keyboard support: Left/Right arrow keys navigate, Escape closes

3. **Render navigation arrows in the lightbox**
   - Left arrow: `ChevronLeft` icon, positioned absolute on the left edge, large click target
   - Right arrow: `ChevronRight` icon, positioned absolute on the right edge
   - Semi-transparent white on dark background, hover brightens
   - Photo counter indicator (e.g., "3 / 12") at the bottom

4. **Visual design**
   - Arrows: 48px circular buttons with `bg-white/20 hover:bg-white/40` backdrop
   - Positioned vertically centered on left/right edges with comfortable padding
   - Counter: small white text below the caption

