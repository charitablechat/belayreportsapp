

## Enable Offline Caption Editing for Photos

### Problem
Currently, the caption input is hidden for unsynced (offline) photos — it shows "Caption available after sync" instead. The `PhotoCaptionInput` component also silently skips saving when offline, meaning any edits would be lost.

### Solution
Allow editing captions on offline photos by:
1. Storing captions in IndexedDB alongside the photo blob
2. Showing the caption input for all photos (not just uploaded ones)
3. Syncing the caption when the photo eventually uploads

### Changes

**1. `src/lib/offline-storage.ts`** — Add `updateOfflinePhotoCaption` function
- Opens the `photos` store, gets the record by ID, updates its `caption` field, puts it back
- Simple IndexedDB read-modify-write

**2. `src/components/PhotoGallery.tsx`** — Show caption input for offline photos too
- Lines 717-735: Replace the conditional that hides captions for unsynced photos
- Show `PhotoCaptionInput` for all photos, passing the offline caption from the Photo object
- For unsynced photos, pass an `onOfflineCaptionChange` callback that updates both local state and IndexedDB

**3. `src/components/PhotoCaptionInput.tsx`** — Support offline-only saving
- Add optional `onOfflineSave` prop
- When offline (or when `onOfflineSave` is provided), call `onOfflineSave(newCaption)` instead of trying Supabase
- Remove `disabled={isSaving}` guard so the input stays editable offline

**4. `src/lib/sync-manager.ts`** — Use stored caption during photo sync
- In `syncPhotos()` (line ~108), read `photo.caption` from the IndexedDB record and use it in the database insert instead of falling back to `photo.section`

### File Summary

| File | Change |
|------|--------|
| `src/lib/offline-storage.ts` | Add `updateOfflinePhotoCaption(photoId, caption)` function |
| `src/components/PhotoCaptionInput.tsx` | Add `onOfflineSave` prop; call it when offline instead of Supabase |
| `src/components/PhotoGallery.tsx` | Show caption input for unsynced photos; wire up offline save to IndexedDB |
| `src/lib/sync-manager.ts` | Use `photo.caption` from IndexedDB when inserting photo record during sync |

