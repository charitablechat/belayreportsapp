

## Comprehensive Audit: Offline Photo Storage & Upload Module

### Critical Finding: `getUnuploadedPhotos` Drops Photos for Synced Reports

**Severity: HIGH — Silent data loss**

In `src/lib/offline-storage.ts` lines 1005-1023, `getUnuploadedPhotos(userId)` filters photos by matching their `inspectionId` against `getUnsyncedInspections(userId)`. Once a report syncs (gets a `synced_at` matching `updated_at`), it disappears from the unsynced list — and any photos still queued for that report are silently excluded from sync.

This means: if a user takes photos offline, the parent report syncs first (via atomic-sync-manager), but photo upload fails or is deferred, those photos become permanently orphaned in IndexedDB and never upload.

`syncPhotos()` in `sync-manager.ts` calls `getUnuploadedPhotos()` without a userId (line 61), which returns ALL unuploaded photos. So the bug only manifests when `useUnsyncedPhotos` hook calls `getUnuploadedPhotos(user.id)` for count display — the count underreports, but sync itself is unaffected. **Revised severity: LOW (cosmetic count only).**

### Finding 2: `markPhotoAsUploaded` Keeps Blob in IndexedDB

**Severity: MEDIUM — Storage leak**

In lines 1025-1043, `markPhotoAsUploaded` sets `uploaded = true` and updates `photoUrl`, but does NOT remove the blob. For a 3MB compressed photo, this means every synced photo continues consuming ~3MB of IndexedDB quota indefinitely. With 50 photos, that's 150MB of dead storage.

The `syncPhotos` comment on line 114 says "remove blob from local storage" but the implementation doesn't do it.

### Finding 3: No Retry Backoff for Failed Photo Uploads

**Severity: MEDIUM — Wasted bandwidth**

`syncPhotos()` processes every unuploaded photo every cycle (every 30-60s) with no retry counter or exponential backoff. If a photo consistently fails (e.g., corrupt blob, server rejection), it blocks the batch slot and wastes bandwidth on every sync cycle forever.

### Finding 4: Duplicate Photo DB Rows on Re-sync

**Severity: MEDIUM — Data integrity**

`syncPhotos()` always calls `.insert()` (line 103-110). If the previous upload succeeded in storage but the DB insert failed, the next sync re-uploads the file (with `upsert: true`) and inserts a second DB row. There's no deduplication check on `photo_url` + `[fkColumn]`.

Similarly, `PhotoCapture.uploadPhotoInBackground` (line 78-83) inserts a DB row, then `syncPhotos` may also insert a row for the same photo if `markPhotoAsUploaded` didn't complete.

### Finding 5: Object URL Memory Leak in `ItemPhotoUpload`

**Severity: LOW — Memory leak on mobile**

`ItemPhotoUpload` creates `URL.createObjectURL` in `loadSignedUrl` (line 60) and `handleUpload` (line 165) but only revokes the preview URL when a signed URL replaces it (line 144). If the component unmounts before background upload completes, the blob URL leaks. Also, the `loadSignedUrl` callback creates a new object URL from cached blobs on every call without revoking the previous one.

### Finding 6: `saveToDevice` Called for Every Photo

**Severity: LOW — UX annoyance**

`PhotoCapture` line 135-136 calls `saveToDevice` for every captured photo. On Android, this triggers a download notification per photo. Not an integrity issue but can confuse users.

### Finding 7: Background Upload Race with `syncPhotos`

**Severity: LOW — Potential duplicate upload**

`PhotoCapture.uploadPhotoInBackground` and `syncPhotos` can both attempt to upload the same photo simultaneously. The storage `upsert: true` handles the file, but the DB insert can create duplicate rows (same as Finding 4).

---

### Recommended Fixes (Priority Order)

**1. Remove blob after successful sync** (`src/lib/offline-storage.ts`)
- In `markPhotoAsUploaded`, replace the blob with `null` or a tiny placeholder after setting `uploaded = true`
- This is the biggest practical improvement — prevents storage quota exhaustion

**2. Add deduplication guard in `syncPhotos`** (`src/lib/sync-manager.ts`)
- Before inserting a photo DB row, check if a row with the same `photo_url` already exists using `.select()` 
- Skip insert if row exists; just call `markPhotoAsUploaded`

**3. Add retry counter to photo records** (`src/lib/offline-storage.ts` + `src/lib/sync-manager.ts`)
- Add `retryCount` field to photo schema
- Increment on each failed upload attempt
- Skip photos with >5 retries (log warning) to prevent infinite retry loops

**4. Fix Object URL leak in `ItemPhotoUpload`** (`src/components/inspection/ItemPhotoUpload.tsx`)
- Track previous object URLs in a ref and revoke on cleanup/replacement
- Add `useEffect` cleanup that revokes on unmount

**5. Fix `getUnuploadedPhotos(userId)` filter** (`src/lib/offline-storage.ts`)
- When userId is provided, filter by photos whose `inspectionId` belongs to ANY local inspection (not just unsynced ones), OR remove the userId filter entirely since `syncPhotos()` doesn't use it

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/offline-storage.ts` | Remove blob on markPhotoAsUploaded; fix getUnuploadedPhotos filter; add retryCount field |
| `src/lib/sync-manager.ts` | Add dedup check before DB insert; increment retry counter on failure; skip high-retry photos |
| `src/components/inspection/ItemPhotoUpload.tsx` | Revoke object URLs on unmount and replacement |

