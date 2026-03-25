

## Add Caption to Offline Photo Sync Pipeline

### Problem
When a photo is uploaded to a specific item (equipment, zipline, or operating system), the online upload path correctly inserts it into the photo gallery with a caption (the item name). However:

1. If the background upload fails and the photo is later synced by `syncPhotos()`, **no caption is saved** because the offline storage schema doesn't include a `caption` field.
2. The `syncPhotos` function inserts gallery records without a caption (line 92-98 of `sync-manager.ts`).

### Solution
Thread the `caption` through the entire offline photo pipeline so that both online and offline uploads produce correctly labeled gallery entries.

### Changes

**1. `src/lib/offline-storage.ts` — Add `caption` to `savePhotoOffline` interface**
Add an optional `caption?: string` field to the photo parameter. Store it in IndexedDB alongside other metadata.

**2. `src/components/inspection/ItemPhotoUpload.tsx` — Pass `caption` when saving offline**
Add `caption: itemName || 'Item photo'` to the `savePhotoOffline()` call (around line 170).

**3. `src/lib/sync-manager.ts` — Use stored caption during gallery insert**
In `syncPhotos()`, include `caption: photo.caption || photo.section` in the database insert (line 94-98).

### Files
| File | Change |
|------|--------|
| `src/lib/offline-storage.ts` | Add `caption` to `savePhotoOffline` parameter type |
| `src/components/inspection/ItemPhotoUpload.tsx` | Pass `caption` in `savePhotoOffline` call |
| `src/lib/sync-manager.ts` | Include `caption` in gallery insert during offline sync |

