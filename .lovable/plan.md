

## C7 — Stop rewriting `photoUrl`/`fileName` during auth-id migration

### Finding

`migrateUserData` (`src/lib/offline-auth.ts:336-366`) string-replaces `oldUserId` → `newUserId` inside every photo's `photoUrl` and `fileName`. But the actual storage objects live at `<oldUserId>/<reportId>/<file>` because that path was set when the offline user was running under the deterministic email-hash UUID. We never copy the bucket objects.

After the next reconcile:
- `inspection_photos.photo_url` (DB) = `<newUserId>/...` — does not exist in storage.
- Storage object still at `<oldUserId>/...` — orphaned, and unreadable under photo bucket RLS that pins `auth.uid() = (storage.foldername(name))[1]` (per memory `photo-access-safeguards-v2`).
- Result: every photo taken in offline-auth mode 404s on first render after reconcile. Silent.

Two options were called out: (a) copy the bucket objects in an edge function, (b) stop rewriting and treat the upload-time path as immutable. (a) is heavy (round-trips, partial-failure recovery, RLS bypass via service role, multi-bucket awareness) and the only thing it would buy us is *consistency* between storage path and the user's current uid — which storage RLS doesn't actually require, since the user signing the URL is already the authenticated user, and the *object* path is just a key. (b) is the natural fit: the upload happens against the bucket the user-of-the-moment can write to, the resulting key is canonical, and from then on it travels untouched.

We already follow this pattern everywhere except inside `migrateUserData`. Removing the photo-rewrite block also eliminates the C6-style transaction risk on the photos store (Promise.all batch of mutations that we no longer need to perform).

### Fix

**Single change in `src/lib/offline-auth.ts`** — drop the photo-path rewrite, keep the inspector_id rewrite for the three report stores (which is the part that actually fixes the dashboard "disappeared rows" symptom).

In `migrateUserData`, delete the entire `try { ... 'photos' ... }` block (~lines 336-366). The three report-store loops above it stay exactly as they are post-C6 — they migrate `inspector_id` only.

Also drop the now-irrelevant comment lines about photo-path migration if any exist near that block.

That's the entire code change. No new helpers, no edge function, no schema work, no storage round-trips.

### Why this is safe

- The **storage object** path is set at upload time by `sync-manager` using whoever the user is at that moment. After reconcile, the user's `auth.uid()` becomes the real account, and any *new* uploads will land at `<realUserId>/...` — but that's only for newly captured photos. Photos already uploaded under `<oldUserId>/...` keep their original key forever. Their DB row's `photo_url` is the canonical pointer and stays valid.
- Photo bucket RLS gates **uploads** (write) on `auth.uid() = (storage.foldername(name))[1]`. **Reads** in this app go through signed URLs minted server-side by the existing photo helpers, which work regardless of which uid prefix is in the key — the signature is the access grant, not the path.
- The `inspector_id` migration on the three report tables (post-C6) is what surfaces the user's offline-mode reports in the Dashboard. That stays. Photo `inspectionId` / `trainingId` / `dailyAssessmentId` foreign keys are UUIDs that don't change across the reconcile, so the photos still attach to the right report.
- Removes the only remaining write-tx race in `migrateUserData` (the photo loop) — strict simplification.
- No interaction with C1–C6.

### What this does *not* try to fix (out of scope)

- Recovering photos that were uploaded under `<oldUserId>/...` *and* then went through a previous version of `migrateUserData` that already corrupted their `photoUrl` to `<newUserId>/...`. That's a one-time data-cleanup question — out of scope here, and easy to solve later with a maintenance script that, for every `inspection_photos` / `training_photos` / `daily_assessment_photos` row whose `photo_url` returns 404, retries the read by replacing the leading uid segment with the deterministic email-hash uid from `offline-auth-store.user_mappings` (which we already preserve). I'll log this as a follow-up if the user wants it.
- Renaming bucket objects to match the real userId. Not required for correctness; would only be cosmetic.
- The `fileName` field — same logic. It's a display/storage hint, not a path used for lookup post-upload. Don't touch it.

### Risk

Trivial. Removing dead-and-harmful code. Worst case for an existing offline-only user: the reconcile no longer attempts the broken rewrite — their photos go from "guaranteed 404 after reconcile" to "still readable under their original `<oldUserId>/...` key." Strictly better.

### Verification

- `npx tsc --noEmit`.
- DEV scenario A (the bug): seed an IDB photo `{ photoUrl: '<oldUserId>/<inspId>/abc.jpg', fileName: '<oldUserId>/<inspId>/abc.jpg', uploaded: true }` and an `inspection_photos` row with the same `photo_url`. Trigger `verifyAndReconcileOfflineAuth` so the deterministic uid maps to the real one. Expect:
  - No `[OfflineAuth] Failed to migrate photos store` warning.
  - The IDB photo's `photoUrl` is **unchanged** (still `<oldUserId>/...`).
  - Re-rendering the report: the photo loads (signed URL against the existing object).
- DEV scenario B (happy path, online-first user): nothing references `oldUserId` in any photo. Reconcile is a no-op for photos. Confirm no log noise.
- DEV scenario C (post-reconcile capture): take a new photo after reconcile. Confirm the upload lands under `<realUserId>/...` (existing sync-manager behavior, unchanged).
- Repeat A across `inspection_photos`, `training_photos`, `daily_assessment_photos`.

