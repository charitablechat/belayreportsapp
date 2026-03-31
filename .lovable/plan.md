

## Add Full-Size Image Modal to Photo Gallery

**What**: Tapping a photo thumbnail in the bottom gallery section opens a full-size lightbox modal. Clicking outside the image closes it. This matches the existing `ItemPhotoUpload` lightbox pattern.

### Changes

**1. `src/components/PhotoGallery.tsx`** — Add lightbox state and modal

- Add `selectedPhoto` state (`Photo | null`) to track which photo is expanded
- On thumbnail click (when NOT in batch mode and NOT dragging), set `selectedPhoto`
- Render a `Dialog` at the bottom of the component that shows the full-size image
- Use `DialogContent` with `hideDefaultClose` and transparent/minimal styling so clicking the overlay closes it
- The modal displays the image at full resolution with the caption below it

**Key implementation detail**: The click handler goes on the `OptimizedImage` container (line ~680). In batch mode, clicks already go to `toggleSelection`. We add an `onClick` to the image area only when `!batchMode`:

```tsx
// New state
const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);

// On the image div (line ~668), add click when not in batch mode:
onClick={!batchMode ? () => setSelectedPhoto(photo) : undefined}

// New Dialog after the delete confirmation dialog:
<Dialog open={!!selectedPhoto} onOpenChange={(open) => { if (!open) setSelectedPhoto(null); }}>
  <DialogContent className="max-w-4xl p-2 bg-black/95 border-none">
    {selectedPhoto && (
      <img
        src={selectedPhoto.photoUrl}
        alt={selectedPhoto.caption || "Full size photo"}
        className="w-full h-auto max-h-[85vh] object-contain rounded"
      />
    )}
    {selectedPhoto?.caption && (
      <p className="text-center text-white/80 text-sm mt-2">{selectedPhoto.caption}</p>
    )}
  </DialogContent>
</Dialog>
```

No new files needed. Single file change, consistent with the existing `Dialog`-based lightbox in `ItemPhotoUpload`.

