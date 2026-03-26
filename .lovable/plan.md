

## Fix: Duplicate Photos in Gallery

### Root Cause
Two paths insert into `inspection_photos` for the same photo:
1. `ItemPhotoUpload.uploadInBackground` inserts with real path (`userId/inspectionId/items/itemId.jpg`)
2. `syncPhotos` finds the photo still `uploaded=false` in IndexedDB, uploads again, and its dedup check uses the original `pending/...` path — no match → second row

### Changes

#### 1. `src/components/inspection/ItemPhotoUpload.tsx`
Move `markPhotoAsUploaded(photoId, filePath)` from line 148 to immediately after the storage upload succeeds (after line 132), **before** the gallery insert. This closes the race window — if `syncPhotos` runs concurrently, it will see `uploaded=true` and skip the photo.

```
// Line 132: if (uploadError) throw uploadError;

// ✅ Mark uploaded FIRST to close race window with syncPhotos
await markPhotoAsUploaded(photoId, filePath);

// Then insert into gallery...
```

#### 2. `src/lib/sync-manager.ts`
After the storage upload succeeds (line 118), re-read the photo from IndexedDB to check if another thread already marked it uploaded. If so, skip the DB insert.

Add after line 118:
```typescript
// Re-check: another thread (uploadInBackground) may have already handled this
const recheckPhotos = await getUnuploadedPhotos();
const stillUnuploaded = recheckPhotos.find(p => p.id === photo.id);
if (!stillUnuploaded) {
  if (import.meta.env.DEV) {
    console.log('[Sync Manager] Photo already marked uploaded by another thread:', photo.id);
  }
  successCount++;
  continue;
}