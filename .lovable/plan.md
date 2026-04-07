

# Move Close Button Outside the Photo Area

Currently the X button is positioned `absolute right-3 top-3` inside the `DialogContent`, which places it over the photo. The fix moves it above/outside the photo into the black padding area of the lightbox, making it clearly visible and separate from the image.

## Changes

### 1. `src/components/PhotoGallery.tsx` (line ~877-883)

Move the close button outside the photo container and position it in the top-right of the dialog's black area, above the image. Change from `absolute` positioning inside the content to a flex row at the top:

```tsx
{/* Close row — sits above the photo in the black area */}
<div className="flex justify-end pb-1">
  <button
    onClick={closeLightbox}
    className="w-10 h-10 rounded-full bg-white/20 hover:bg-red-600 flex items-center justify-center transition-colors"
    aria-label="Close lightbox"
  >
    <X className="w-6 h-6 text-white" />
  </button>
</div>
```

Remove the old `absolute right-3 top-3` button. The photo container (`<div className="relative select-none">`) stays unchanged below it.

### 2. `src/components/inspection/ItemPhotoUpload.tsx` (line ~405-411)

Same pattern: replace the absolute-positioned button with a flex row above the photo content. Move it before the `<div className="flex flex-col items-center ...">` block.

Two files, styling-only changes. The X will now sit clearly in the black border area, never overlapping the photo.

