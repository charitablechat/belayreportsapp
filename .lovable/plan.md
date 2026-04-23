

## C5 — Stop the photo sync from poisoning `photo_url` with the IDB UUID

### Finding

`src/lib/sync-manager.ts:230` — when the sync loop hits a photo whose `blob` has gone null mid-batch, it does:

```ts
await markPhotoAsUploaded(photo.id, photo.photoUrl || photo.id);
```

If `photo.photoUrl` is null (legitimate states: a partial-write where `markPhotoAsUploaded` previously failed mid-`put`, or a photo created by an old code path that never stamped a `photoUrl`), the `|| photo.id` fallback writes the IDB **UUID** as `photo_url`. That UUID is not a valid storage key — any later signed-URL fetch returns 404 and the report renders a broken image. It also short-circuits any chance to recover the photo, because `uploaded` is now `true` and `markPhotoAsUploaded` has nulled the blob (already null here) and zeroed the retry counter.

The bug is small but the blast radius is permanent: once stored, the bad path propagates into `inspection_photos.photo_url` on the next DB insert and stays there.

### Fix

Single edit in `src/lib/sync-manager.ts` around line 225–233, no new helpers needed. The two real cases to separate:

```ts
// Guard: blob must exist (may have been nullified by a previous partial success)
if (!photo.blob) {
  if (photo.photoUrl && !photo.photoUrl.startsWith('pending/')) {
    // Real, non-pending storage path is on record — the previous upload
    // succeeded and only the markPhotoAsUploaded write lost its way.
    // Safe to finalize with the known-good path.
    if (import.meta.env.DEV) {
      console.warn('[Sync Manager] Finalizing photo with null blob but known photoUrl:', photo.id);
    }
    await markPhotoAsUploaded(photo.id, photo.photoUrl);
    changedCount++;
    return;
  }

  // No blob AND no trustworthy photoUrl — we cannot reconstruct the upload.
  // Surface as a permanent dead-letter so the user sees it in
  // SyncDiagnosticsSheet instead of a silent broken-image landmine in the
  // rendered report.
  console.error('[Sync Manager] Photo has no blob and no photoUrl — dead-lettering:', photo.id);
  await setPhotoLastError(photo.id, 'Photo data missing (no blob and no storage path). Re-capture required.');
  // Bump straight to the ceiling so it appears in the dead-letter UI on the next refresh
  // without waiting MAX_PHOTO_RETRIES cycles (the photo is not recoverable by retry).
  for (let i = 0; i < MAX_PHOTO_RETRIES; i++) {
    await incrementPhotoRetryCount(photo.id);
  }
  changedCount++;
  return;
}
```

That's the entire change. Same return-shape, same `changedCount` accounting, no schema work.

### Why this is safe

- **Common happy path** (blob present): unchanged — falls through to the existing upload code below.
- **Recoverable null-blob** (real `photoUrl` present): finalizes correctly with the known-good path. This is the same outcome the bug accidentally produces in the `photo.photoUrl` truthy branch today, just without the toxic fallback.
- **Unrecoverable null-blob**: now goes to the dead-letter UI (existing S22 plumbing — `setPhotoLastError` + retry-count saturation). The user gets a visible, actionable item in `SyncDiagnosticsSheet` instead of a permanently broken image inside a completed report.
- **`pending/` paths** are excluded from the "trustworthy photoUrl" branch because the path-rewrite code earlier in the loop (S23, lines ~190–222) is the only thing that turns them into real keys, and it requires a blob.
- No interaction with C1–C4 (different subsystem).
- `getUnuploadedPhotos` already filters out null-blob photos at the source (`offline-storage.ts:1676`), so this branch fires only on photos whose blob went null *during* the in-flight batch — a very narrow race.

### Out of scope

- Changing `markPhotoAsUploaded` itself. Its callers in `PhotoCapture.tsx` and `ItemPhotoUpload.tsx` always pass a valid storage path, so the fix belongs at the sync-manager call-site that has the bad `|| photo.id` fallback.
- Re-uploading from a recovered blob — there is no blob to re-upload here; that's why we dead-letter.
- Any change to `pruneOldSyncedPhotoBlobs` (it correctly only nulls `uploaded === true` blobs, so it isn't a current trigger of this bug).

### Risk

Trivial. One file, one branch, no new persisted state. Worst case, a photo that today silently becomes a broken image in a report instead becomes a visible dead-letter entry — strictly better.

### Verification

- `npx tsc --noEmit`.
- DEV scenario A (the bug): seed an IDB photo record `{ id: 'abc-123', uploaded: false, blob: null, photoUrl: null, inspectionId: <real-uuid> }`. Trigger a sync cycle. Expect:
  - Console: `[Sync Manager] Photo has no blob and no photoUrl — dead-lettering: abc-123`.
  - The photo's `lastError` is set, retryCount === `MAX_PHOTO_RETRIES`, `uploaded` stays false.
  - **No** new row written to `inspection_photos` with `photo_url = 'abc-123'`.
  - The photo appears in `SyncDiagnosticsSheet`'s dead-letter section.
- DEV scenario B (recoverable race): seed `{ id, uploaded: false, blob: null, photoUrl: '<userId>/<inspId>/123.jpg', inspectionId: <real-uuid> }`. Trigger sync. Expect:
  - Console: `[Sync Manager] Finalizing photo with null blob but known photoUrl: <id>`.
  - `markPhotoAsUploaded` runs with the real path; `uploaded === true`; no toxic UUID anywhere.
- DEV scenario C (happy path): a normal capture-then-sync. Confirm no `[Sync Manager] Finalizing` and no `[Sync Manager] Photo has no blob` lines, and the upload completes through the existing code path.

