# Fix the stuck "50 pending" badge

Two surgical fixes that together drain the iPad badge and prevent the same situation from re-accumulating. No behavioural change to actually-pending records, no UI rework.

Important update from your reply: the iPad has only ever held your account, and you have not signed in there for two months. That rules out the "shared device" theory but **strengthens** the "stale residue" theory — the ~49 phantom photos are almost certainly tied to inspections that have since been deleted, evicted, or whose UUID parent was never re-pulled into that iPad's IndexedDB. The orphan check below is what actually drains them.

---

## Change 1 — Cross-device "pending inspection" counter

File: `src/lib/local-data-guards.ts`

Extend `shouldPreserveLocalRecord` to optionally take the matching server payload. When the server confirms it already has the edit (`server.synced_at >= local.updated_at - tolerance`), return `false` — the server has caught up, the local copy is no longer authoritative, and the dashboard ingest path is allowed to overwrite local IDB so `synced_at` re-anchors and the badge clears.

Existing single-argument signature stays as a back-compat wrapper. Every current call site keeps working unchanged.

Update the dashboard cache-write call site to pass the server row it just fetched.

Stamp `last_sync_source = 'main_thread'` on the remaining write paths that currently leave it `NULL` (10 of 32 recent rows on the server today). This is purely diagnostic, but without it we cannot attribute future drift rows.

## Change 2 — Photo "pending" counter is not user-scoped

File: `src/lib/offline-storage.ts`

`getUnuploadedPhotos(userId?)` accepts a `userId` argument and ignores it. The hook (`useUnsyncedPhotos`) already passes `user.id` — the function just needs to honour it.

Three surgical edits, all inside the existing read boundary:

1. **Honour `userId` in `getUnuploadedPhotos`.** When a `userId` is supplied, drop any photo where either:
   - `capturedByUserId` is set and not equal to `userId`, OR
   - the parent inspection exists in IDB, `inspector_id !== userId`, and `capturedByUserId !== userId`.
   Photos with no `capturedByUserId` and no resolvable parent stay visible (orphan-recovery path used by the existing S23 backfill).
2. **Add a UUID-parent existence check** mirroring the existing `temp-*` orphan check, capped at 200 parent lookups per call so a bloated store cannot tip the IDB read boundary. Photos whose UUID parent is missing from local IDB drop out of `getUnuploadedPhotos` and surface in `getDeadLetterPhotos` instead — they are unrecoverable from this device and should not block the badge.
3. **Apply the same scoping (steps 1 + 2) to `getDeadLetterPhotos`** so the SyncPulse "Retry Now" action only ever touches photos this user can actually upload.

## Tests

New file: `src/lib/__tests__/photo-unsynced-user-scope.test.ts` — locks four contracts:

- Photos tagged `capturedByUserId = A` are excluded from `getUnuploadedPhotos(B)`.
- Photos with no `capturedByUserId` whose parent inspection has `inspector_id = A` are excluded from `getUnuploadedPhotos(B)`.
- Photos with no `capturedByUserId` and no parent in IDB are still returned by `getUnuploadedPhotos(B)` (orphan-recovery path).
- Photos with a UUID parent that does not exist in IDB are returned by `getDeadLetterPhotos` (and not by `getUnuploadedPhotos`).

Append one test to `src/lib/local-data-guards.test.ts` covering the new server-payload overload of `shouldPreserveLocalRecord`: when `server.synced_at >= local.updated_at - tolerance`, returns `false` even though local drift exceeds the tolerance.

## What the user will observe after deploy

- The iPad's "50 pending" badge will drop to whatever genuinely belongs to you on that device — almost certainly to `0` once the next sync cycle runs the new filter. No manual action needed.
- The Camp Eagle row clears on the desktop the next time the dashboard re-fetches it from the server.
- Future drift rows will carry `last_sync_source` so we can root-cause without asking you to reproduce.

## Out of scope

- No change to `MAX_PHOTO_RETRIES`, no change to backoff windows, no change to `sync-quarantine`.
- No automated cleanup of phantom photos in IDB — the filter alone is enough to drain the badge; a destructive purge would risk losing a real photo.
- No edge function changes. Server is healthy.

## Memory updates after merge

Add a short memory entry under `mem://constraints/photo-pending-user-scope` documenting that `getUnuploadedPhotos` and `getDeadLetterPhotos` MUST filter by `userId` and orphan UUID parents, with a pointer to the new test file.
