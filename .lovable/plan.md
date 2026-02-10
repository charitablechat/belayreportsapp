
# Fix: Offline Photos Lost During Temp-ID-to-UUID Sync

## Problem

When a report is created offline with a temporary ID (`temp-...`), photos are saved in IndexedDB with `inspectionId` set to that temp ID. During sync, `syncInspectionAtomic` correctly replaces the temp ID with a real UUID for the inspection and all child records (systems, ziplines, equipment, standards, summary) -- but **photos are never updated**. They remain tagged with the old temp ID.

When `syncPhotos()` runs afterwards, it tries to insert `inspection_id: photo.inspectionId` (still the temp ID) into the `inspection_photos` table. This fails because no inspection with that temp ID exists in the database. The photos silently fail to upload and are eventually lost.

## Solution

Two changes in two files:

### 1. `src/lib/offline-storage.ts` -- Add a photo relinking function

Add a new exported function `relinkPhotosToNewInspectionId(oldId, newId)` that:
- Opens the `photos` store in IndexedDB
- Queries all photos where `inspectionId === oldId` using the `by-inspection` index
- For each matching photo, updates `inspectionId` to `newId` and writes back via `db.put`
- Logs the count of relinked photos

```typescript
export async function relinkPhotosToNewInspectionId(
  oldInspectionId: string,
  newInspectionId: string
): Promise<number> {
  // wrapped in withIndexedDBErrorBoundary for safety
  // query photos index 'by-inspection' for oldInspectionId
  // update each photo's inspectionId to newInspectionId
  // return count of updated photos
}
```

### 2. `src/lib/atomic-sync-manager.ts` -- Call relinking after temp-ID cleanup

In `syncInspectionAtomic`, inside the `if (inspectionIdMapping)` block (around line 430), add a call to `relinkPhotosToNewInspectionId(oldId, newId)` **after** the child record cleanup and **before** returning success. This ensures photos are re-parented to the permanent UUID before `syncPhotos()` attempts to upload them.

The insertion point is after the existing child record re-save (line 449) and before the success log (line 452):

```
// existing: save child records under new UUID (line 443-449)
// NEW: relink photos from temp ID to new UUID
await relinkPhotosToNewInspectionId(oldId, newId);
// existing: success log (line 452)
```

## What Changes in Behavior

- Photos captured offline for a temp-ID report will have their `inspectionId` updated to the permanent UUID immediately after the report syncs
- When `syncPhotos()` runs (called in the same sync cycle via `useAutoSync`), the photos will reference the correct UUID and upload successfully
- No new UI changes -- `SyncPulse` already shows pending photo counts and errors
- Zero data loss: photos remain in IndexedDB until explicitly marked as uploaded
- No validation bypass: the UUID transformation happens before any server-bound payload is constructed
