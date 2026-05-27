# Peaceable Kingdom photo placeholders — root cause and fix plan

## Root cause (confirmed from the database, not a guess)

The Peaceable Kingdom inspection (`d8bac5de-5e89-4695-871a-3bc815ae1858`) has 6 `inspection_photos` rows pointing at storage paths under `inspection-photos/62ef2a7b…/d8bac5de…/items/*.jpg`. All six storage objects **exist** with `mimetype = image/jpeg` but `size = 0 bytes`. Signed URLs are generated successfully, but the bytes are empty, so the browser renders a broken-image placeholder ("place marker").

A scan of this inspector's bucket prefix shows **9 zero-byte objects out of 234** — all 6 belong to Peaceable Kingdom, the other 3 belong to one earlier inspection on 2026-05-13. This is rare but reproducible.

There is no display bug. The HTML/report generator is correct; the data on disk is empty.

## Why this happened (hypothesis to confirm during fix)

`ItemPhotoUpload.uploadInBackground` (`src/components/inspection/ItemPhotoUpload.tsx`, line ~359) calls `supabase.storage.from('inspection-photos').upload(filePath, compressed, …)` with **no size check on `compressed`** and no post-upload verification. If the `compressed` File argument is 0 bytes for any reason (HEIC→JPEG path returning an empty blob on a Safari quirk, canvas/toBlob returning null-coerced empty, an IndexedDB read returning an empty ArrayBuffer that got re-wrapped, or a race where the input File was already revoked), the upload silently succeeds and `markPhotoAsUploaded` flips the row to "done." From then on, the system believes the photo is uploaded and will never retry.

## Scope of this fix

Narrow, two-part fix. Display logic, RLS, Storage policies, Service Worker, Workbox, offline-sync architecture, Training, Daily Assessment, and PDF layout are explicitly out of scope.

### Part A — Prevent new 0-byte uploads (forward fix)

Single file: `src/components/inspection/ItemPhotoUpload.tsx`.

1. In `handleUpload`, immediately after `compressed` is produced, assert `compressed.size > 0`. If 0, do not save to IDB, do not write a receipt, do not call `onPhotoChange`, surface a toast, and bail. This stops 0-byte rows from ever entering the pipeline.
2. In `uploadInBackground`, before the `.upload(...)` call, re-check `compressed.size > 0`. If 0, throw — do not write the object, do not call `markPhotoAsUploaded`, do not insert the gallery row. The existing photo stays `pending/` and `useAutoSync` will pick it up from the durable IDB blob (which is non-empty by Part A's gate).
3. After `.upload(...)` returns success, call `supabase.storage.from('inspection-photos').list(parentDir, { search: filename })` (or a `createSignedUrl` + `HEAD`) and confirm `metadata.size > 0`. If the remote object is 0 bytes, throw before marking uploaded so the photo stays queued for retry. (Single extra round trip per upload; only runs on the optimistic capture path.)

### Part B — Recover the 9 stranded photos already in the database

These objects exist with 0 bytes and rows in `inspection_photos`. Two recovery angles, in priority order:

1. **Device-side rescue** (preferred, lossless). The original blob may still live in Luke Benton's iPad IndexedDB under the offline `photos` store keyed by the original photo id. Add a one-shot rescue helper that, for any `inspection_photos.photo_url` whose remote object is 0 bytes AND whose owner has a matching uploaded IDB blob with `size > 0`, re-uploads from the local blob with `upsert: true` and re-marks. Run it opportunistically from the existing `photo-rescue-sweep` module so it triggers next time the user opens the app. No new edge function, no schema change, no Storage policy change.
2. **Reporting fallback** (only if device blob is gone). The 6 affected rows cannot be reconstructed server-side. Update `renderItemPhotoCell` in `supabase/functions/generate-inspection-html/index.ts` (already returns `—` when no signed URL) to additionally treat a 0-byte signed-URL HEAD as "no photo" so the report does not render a broken image. This is cosmetic only; it does NOT delete the row, because the user may still want to recapture.

If Part B step 1 recovers the bytes, step 2 is a no-op for Peaceable Kingdom. If not, the report stops showing broken markers and the user can recapture the 6 photos.

## Verification

1. Unit test in `src/components/inspection/__tests__/` covering: `handleUpload` rejects a 0-byte compressed File, `uploadInBackground` rejects a 0-byte compressed File before `.upload(...)`, and the post-upload size verification throws when the remote object is 0 bytes.
2. Targeted test that the rescue sweep re-uploads when local IDB has bytes and remote is 0.
3. Manual check: run a SQL count of `storage.objects WHERE bucket_id='inspection-photos' AND (metadata->>'size')::bigint = 0` before and after the rescue sweep runs against Luke's device.
4. Focused tests for `ItemPhotoUpload.tsx` and `photo-rescue-sweep`.
5. Full vitest run; report the passing count.

## Confirmations to include in the completion report

- Files changed (expected: `ItemPhotoUpload.tsx`, `photo-rescue-sweep.ts`, the focused test file, and optionally `generate-inspection-html/index.ts` for the cosmetic fallback).
- Exact logic added at each gate.
- Confirmation that no schema, no RLS, no Storage policy, no auth, no Service Worker, no Workbox, no offline-sync architecture, no Training, no Daily Assessment, and no PDF layout changes were made.
- Before/after count of 0-byte objects in the inspector's prefix.
- Whether the 6 Peaceable Kingdom photos were recovered from the device or need recapture.
