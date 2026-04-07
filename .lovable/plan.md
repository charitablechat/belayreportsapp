

# Fix Browser Back Button: Always Navigate Within App

## Problem
Multiple competing `popstate` listeners cause conflicts. The RootLayout guard, PhotoGallery lightbox, and ItemPhotoUpload lightbox each register their own `popstate` handler. When a lightbox is open and the user presses back:
1. RootLayout's handler fires first and incorrectly decrements `navigationDepth`
2. Then the lightbox handler fires and closes the lightbox

This double-handling corrupts the depth counter and can cause premature exits on subsequent back presses.

## Solution
Centralize back-button coordination through a global overlay state tracker in `navigation.ts`. When an overlay (lightbox) is active, the RootLayout popstate handler defers to the overlay's own handler and skips depth tracking.

## Changes

### 1. `src/lib/navigation.ts` — Add overlay tracking
- Add `let overlayActive = false` flag
- Export `setOverlayActive(active: boolean)` and `isOverlayActive()` functions
- Overlays (lightboxes) call `setOverlayActive(true)` when they open and `setOverlayActive(false)` when they close

### 2. `src/App.tsx` — Update RootLayout popstate handler
- Import `isOverlayActive` from navigation
- At the top of the popstate handler, if `isOverlayActive()` returns true, return early (let the overlay's own handler consume the event)
- This prevents depth decrement when back is pressed to close a lightbox

### 3. `src/components/PhotoGallery.tsx` — Register overlay state
- Call `setOverlayActive(true)` when lightbox opens
- Call `setOverlayActive(false)` when lightbox closes (in `closeLightbox` and in the popstate handler)

### 4. `src/components/inspection/ItemPhotoUpload.tsx` — Same treatment
- Call `setOverlayActive(true)` when lightbox opens
- Call `setOverlayActive(false)` when lightbox closes

## Result
- Back button while lightbox is open → closes lightbox only, depth counter unchanged
- Back button on a report page (no overlay) → navigates to previous page normally
- Back button when no history remains → redirects to `/dashboard` (existing guard)
- No premature exits from reports due to corrupted depth counter

