

## Analysis: Photo Sync Race Condition and Timeout Root Causes

### Finding 1: Path Divergence Creates Duplicate Gallery Rows

This is the critical bug. Two different file paths are used for the same photo:

```text
handleUpload saves to IndexedDB:
  photoUrl = "pending/{inspectionId}/items/{itemId}.jpg"

uploadInBackground uploads to storage with:
  realPath = "{userId}/{inspectionId}/items/{itemId}.jpg"

syncPhotos reads IndexedDB and uploads with:
  fileName = photo.photoUrl = "pending/..." (the placeholder)
```

When both run concurrently:
- `uploadInBackground` uploads blob to `userId/...` path, marks uploaded, inserts gallery row with `userId/...` path
- `syncPhotos` uploads blob to `pending/...` path, checks dedup with `.eq('photo_url', 'pending/...')` — finds nothing (because the existing row has `userId/...`), inserts a second gallery row

**Result**: Two storage files and two database rows for one photo.

### Finding 2: Re-check Logic Has a Timing Gap

The re-check at `sync-manager.ts:120-129` queries `getUnuploadedPhotos()` after its own storage upload. But `uploadInBackground` calls `markPhotoAsUploaded` after *its* storage upload too. If `syncPhotos` completes its upload before `uploadInBackground` marks it, the re-check still finds the photo as unuploaded and proceeds to insert a duplicate.

### Finding 3: IndexedDB Contention Causes Timeouts

Console shows repeated `[Offline Storage] Operation timed out after 5000ms`. Both `syncPhotos` (every 30s) and `uploadInBackground` (fire-and-forget) hit IndexedDB concurrently — `getUnuploadedPhotos`, `markPhotoAsUploaded`, `getDB()` — creating write-lock contention, especially on Safari's single-writer model.

### Finding 4: `markPhotoAsUploaded` Placement is Correct but Insufficient

In `ItemPhotoUpload.tsx:134-135`, `markPhotoAsUploaded` is correctly called after storage upload and before gallery insert. However, this doesn't prevent `syncPhotos` from picking up the photo *before* `uploadInBackground` even starts (the auth resolution via `getUserWithCache` adds latency).

---

## Proposed Fix (3 files)

### 1. `src/components/inspection/ItemPhotoUpload.tsx` — Update IndexedDB path before background upload

After resolving the real path (line 231), update the IndexedDB record's `photoUrl` to the real path *before* calling `uploadInBackground`. This eliminates path divergence so `syncPhotos` uses the same path if it wins the race.

```typescript
// Line 230-233: After resolving userId
const realPath = `${user.id}/${inspectionId}/items/${itemId}.jpg`;
// ✅ Update IndexedDB with real path BEFORE upload starts
await updatePhotoPath(photoId, realPath);  // new helper
onPhotoChange(realPath);
uploadInBackground(photoId, compressed, user.id, realPath).catch(() => {});
```

### 2. `src/lib/offline-storage.ts` — Add `updatePhotoPath` helper

New function that atomically updates just the `photoUrl` field without changing `uploaded` status:

```typescript
export async function updatePhotoPath(id: string, newPath: string) {
  // Update photoUrl in IndexedDB so syncPhotos uses the correct path
}
```

### 3. `src/lib/sync-manager.ts` — Skip photos with `pending/` placeholder paths

Add a guard to skip photos whose `photoUrl` starts with `pending/` — these are actively being handled by `uploadInBackground` which will update the path momentarily:

```typescript
// After the temp-ID check (line 87):
if (photo.photoUrl?.startsWith('pending/')) {
  // Path not yet resolved — uploadInBackground will handle this
  continue;
}
```

Also move the re-check *before* the storage upload (not after) to avoid uploading a blob that's already been handled.

### Summary of Changes

| File | Change | Purpose |
|------|--------|---------|
| `ItemPhotoUpload.tsx` | Update IndexedDB path before upload | Eliminate path divergence |
| `offline-storage.ts` | Add `updatePhotoPath()` | Atomic path update without marking uploaded |
| `sync-manager.ts` | Skip `pending/` photos + move re-check earlier | Prevent concurrent uploads of same photo |

This eliminates both the duplicate gallery rows and reduces IndexedDB contention (fewer concurrent operations on the same record).

