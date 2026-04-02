
Root cause analysis

- I checked the current training photo flow and the storage policies. There is no dedicated multipart/form-data upload endpoint for training photos right now; the app uploads directly from the browser to private storage, then inserts a row into `training_photos`.
- The main defect is in `src/components/PhotoCapture.tsx`: it saves and uploads files to paths like `pending/{trainingId}/{photoId}.ext`.
- The `training-photos` bucket policies only allow uploads when the first path segment is the authenticated user id. So the current path shape is rejected by storage RLS.
- `PhotoCapture` already fetches `userId`, but the upload path never uses it. That means the storage upload fails before the DB insert happens, so photos never persist on the server.
- A second defect makes this permanent: `src/lib/sync-manager.ts` skips any queued photo whose `photoUrl` still starts with `pending/`. So failed or offline training photos never self-recover later.
- The frontend rendering failure is a downstream effect of the same bug: after reload, there is no valid remote object + no persisted `training_photos` row to load.
- I also checked frontend secret exposure. I did not find private storage credentials or service-role keys in `src/`; only expected public client env vars are referenced.
- I checked runtime evidence too, but there was no usable session replay, no relevant console snapshot, and no matching network snapshot available in this turn, so the RCA is code-based rather than log-based.

Implementation plan

1. Fix the shared photo upload path in `src/components/PhotoCapture.tsx`
- Build a valid storage path that starts with the authenticated user id.
- Save that resolved path into IndexedDB before attempting upload.
- Keep local-first behavior, but stop leaving training photos stuck on invalid `pending/...` paths.
- Improve error reporting so storage/db failures are visible in logs instead of silently appearing as “saved”.

2. Make queued training photos recover in `src/lib/sync-manager.ts`
- Replace the current “skip pending path” behavior with path normalization + retry.
- When a queued photo still has a placeholder path, derive the real path from the current user + report id + filename metadata, update IndexedDB, and continue the upload.
- This ensures offline captures and temp-id captures can eventually persist once the training record is real.

3. Harden photo relinking in `src/lib/offline-storage.ts`
- When a temp training id is relinked to a real id, also normalize any placeholder photo path that still embeds the old temp id.
- This is a safeguard so the sync layer has less path drift to correct later.

4. Leave storage security intact
- Do not loosen bucket privacy or expose files publicly.
- The policies already look correct; the code path is what needs to match them.
- No secret changes are needed.

5. Add targeted diagnostics in the upload chain
- Log the resolved bucket, storage path, table name, report id, and exact storage/db error.
- If anything still fails after the fix, those logs will identify whether the bottleneck is storage RLS, auth/session state, IndexedDB, or the DB insert.

What I would not change right now

- I would not add a new multipart upload endpoint unless we later decide to move uploads server-side.
- I would not change the backend report generators yet; the current code already reads training photos from storage, and the persistence break appears earlier in the pipeline.
- I do not see a database schema mismatch that requires a migration for this issue.

Files likely to change

- `src/components/PhotoCapture.tsx`
- `src/lib/sync-manager.ts`
- possibly `src/lib/offline-storage.ts`

Validation

- Upload a photo to an existing synced training and confirm storage upload + `training_photos` insert both succeed.
- Reload the training page and confirm the image still renders.
- Upload photos to a new/offline training, sync it, and confirm the queued photos backfill to storage/server after the training gets a real id.
- Re-test specifically on mobile Safari, since the screenshot suggests that environment is affected.
