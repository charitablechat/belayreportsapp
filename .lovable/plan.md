

## Fix: Item Photos Not Appearing in Section Gallery

### Root Cause

When a photo is captured via `ItemPhotoUpload`, it is saved to IndexedDB immediately with the correct `section` (e.g., `"systems"`, `"equipment"`). However, the gallery refresh (`onGalleryRefresh`) is only triggered inside `uploadInBackground` — which runs asynchronously after the cloud upload succeeds (or not at all when offline).

The `PhotoGallery` component at the bottom of each tab is keyed on `photoRefreshKey`. Without an immediate increment of that key after the local save, the gallery never re-renders to pick up the new offline photo from IndexedDB.

### Fix (1 file)

**`src/components/inspection/ItemPhotoUpload.tsx`** — Call `onGalleryRefresh` immediately after saving to IndexedDB (line 199-216 area), not just inside the background upload callback.

Add `onGalleryRefresh?.()` right after the `savePhotoReceipt` call (around line 216), so the gallery re-renders and picks up the new photo from IndexedDB instantly — whether online or offline.

```typescript
// After savePhotoReceipt (line 216):
savePhotoReceipt({ ... });

// ✅ Immediately refresh gallery so the photo appears in the section gallery
onGalleryRefresh?.();

// Then proceed with background upload...
```

This ensures:
- Photo appears in the item's inline thumbnail immediately (already works via `onPhotoChange`)
- Photo also appears in the section gallery at the bottom immediately (via gallery remount picking up the IndexedDB entry)
- When the background upload completes, a second `onGalleryRefresh` fires, updating the gallery with the cloud-synced version
- Works identically offline and online

### Result
- Item photos show both inline (thumbnail in table row) and in the dedicated photo gallery section at the bottom of the tab
- No delay — gallery updates instantly on capture
- Works on desktop, iOS, and Android, online and offline

