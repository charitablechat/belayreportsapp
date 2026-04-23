

## Cross-Platform Photo Upload — Status Audit & Minor Fix

### Status against the spec

| Requirement | Status | Where |
|---|---|---|
| Client-side HEIC → JPEG via `heic2any` | ✅ Done | `src/lib/heic-converter.ts` + `src/lib/image-compression.ts` (auto-detected by magic bytes, quality 0.85, iOS retry/timeout tuning) |
| Skip conversion for JPEG/PNG/WebP | ✅ Done | `isHeicFile`/`isHeicBlob` guards in `image-compression.ts` |
| Loading indicator during conversion | ✅ Done | `uploading` spinner + "Saving…" button state in `PhotoCapture.tsx` and `ItemPhotoUpload.tsx` |
| Camera capture (`capture="environment"`) on mobile, picker on desktop | ✅ Done | `PhotoCapture.tsx` lines 368–384 (separate camera and upload `<input>`s) |
| Multiple photo uploads | ✅ Done | `multiple` attribute on both inputs |
| File-type validation (JPEG/PNG/WebP/HEIC/HEIF) | ✅ Done | `validateFile()` in `PhotoCapture.tsx` |
| **File-size cap = 20 MB** | 🟡 **Currently 25 MB** | `MAX_FILE_SIZE_MB = 25` in `PhotoCapture.tsx` |
| Reject zero-byte files | ❌ Missing | `validateFile()` does not check `file.size === 0` |
| Unique filename `${userId}/${timestamp}-${randomId}.jpg` | ✅ Done (with inspection scoping) | `${user.id}/${inspectionId}/${photoId}.${ext}` in both components |
| Storage path scoped to user folder | ✅ Done | All paths prefixed with `user.id`; `pending/` placeholder is normalized to `${user.id}/` in `sync-manager.ts` |
| Storage RLS — user can only write/read own folder | ✅ Done | Verified against `pg_policy`: INSERT/SELECT/UPDATE/DELETE all gated on `auth.uid()::text = (storage.foldername(name))[1]` for `inspection-photos`, `training-photos`, `daily-assessment-photos` |
| Retry / clear error on failure | ✅ Done | `toast.error` + per-file timeout, photo stays in IDB queue for `useAutoSync` to retry |
| Offline IndexedDB queueing | ✅ Done | `savePhotoOffline` writes to IDB before any network call (local-first) |
| Background sync when online | ✅ Done | `useAutoSync` + `sync-manager.ts` `syncPhotos()` (runs at concurrency 3 mobile / 5 desktop) |
| Visible "queued / not yet uploaded" indicator | ✅ Done | `<CloudOff>` icon in `ItemPhotoUpload.tsx` + `useUnsyncedPhotos` hook surfaces counts in header |
| `convert-heic-photos` edge function untouched | ✅ Done | Last edit was the H3 admin gate; still present and admin-only |
| Auth hooks untouched | ✅ Done | No changes planned to `useRequireAuth`/`useRequireAdmin` |

### What needs to change

Two tiny edits in **`src/components/PhotoCapture.tsx`** to bring it into spec:

1. **Lower file-size cap** — change `const MAX_FILE_SIZE_MB = 25;` to `20`.
2. **Reject zero-byte files** — in `validateFile()`, add an early check:
   ```ts
   if (file.size === 0) {
     return { valid: false, error: 'File is empty (0 bytes). Please choose a different photo.' };
   }
   ```

That's it. Everything else the prompt asks for is already implemented and verified.

### Files touched
- `src/components/PhotoCapture.tsx` — two lines (constant + one validation branch)

### Out of scope (already correct)
- `convert-heic-photos` edge function — left untouched
- Storage RLS policies — verified correct, no SQL migration needed
- Auth hooks — untouched
- `ItemPhotoUpload.tsx` — uses the same `compressImage` pipeline; no change needed (it routes through `validateFile` indirectly via the same compression path, and item photos go through `handleUpload` which has its own 15s timeout)

### Risk
Trivial. No DB, no edge functions, no schema, no new dependencies.

