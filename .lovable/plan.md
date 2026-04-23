

## S23 — Bind staged photos to the capturing user, not the syncing user

**Problem.** In `src/lib/sync-manager.ts` (lines 104–126), photos saved with a `pending/` prefix get rewritten to `${currentUser.id}/...` at sync time. If user A captures photos offline, signs out, and user B signs in on the same device, those photos upload under B's storage tree and get attributed to B — even though they belong to A's inspection.

### Design

1. **Capture-time binding (preferred fix).** When a photo is staged offline:
   - If a real `auth.uid()` is available, write the path as `${user.id}/${inspectionId}/${ts}.${ext}` directly — no `pending/` prefix needed.
   - If truly no user is known (extremely rare; pre-auth capture), fall back to the offline cached user from `getOfflineUserId()` / `cached-auth.ts` and use that id.
   - Only as a last resort, write `pending/${capturedByHint}/...` where `capturedByHint` is whatever id we *did* know at capture time, even if stale. Persist a new `OfflinePhoto.capturedByUserId: string` field alongside the existing record.

2. **Sync-time guard (defense in depth).** In `syncPhotos`:
   - Read `photo.capturedByUserId`. If it exists and does **not** match the current `auth.uid()`, **do not** rewrite the path to the current user. Instead:
     - If the capturing user can still be resolved as the active session user later → leave the photo queued and skip this cycle (log `[Sync Manager] Skipping photo captured by different user`).
     - If the photo has been waiting > 7 days with no matching user session, surface it via the existing dead-letter / `lastError` channel from S22 with message `Photo belongs to a different signed-in user`. The user can then `Discard` from `SyncDiagnosticsSheet`.
   - Only rewrite `pending/` → `${currentUser.id}/` when `capturedByUserId` is missing (legacy records) **and** the inspection's `inspector_id` matches the current user. Otherwise treat as the cross-user case above.

3. **Inspection ownership cross-check.** As a secondary signal, look up the parent inspection's `inspector_id` (already in IDB for offline reports). If `photo.capturedByUserId !== inspection.inspector_id`, the photo is misattributed regardless of who's signed in — log and route to dead-letter.

4. **Migration for existing `pending/` photos.** One-time, on app boot:
   - Scan IDB for photos with `photoUrl` starting with `pending/` and no `capturedByUserId`.
   - If exactly one user has ever signed in on this device (check `cached-auth` history / a single profile in IDB), backfill `capturedByUserId` with that id. Otherwise leave them; they'll fall through to the dead-letter path on next sync attempt.

### Files

- **`src/lib/offline-storage.ts`** — add optional `capturedByUserId?: string` to `OfflinePhoto` type; helper `setPhotoCapturedBy(id, userId)`; one-time `backfillCapturedByUserIdForPendingPhotos()` migration helper.
- **`src/lib/photo-cache.ts`** *(or wherever `addOfflinePhoto` is called from `PhotoCapture.tsx`)* — at staging time, resolve user (online → `getUserWithCache`; offline → `getOfflineUserId`) and store as `capturedByUserId`. Build the storage path with that id directly when known; only emit `pending/` when truly nothing is resolvable.
- **`src/lib/sync-manager.ts`** — replace the unconditional `pending/` → current-user rewrite (lines 104–126) with the guarded logic in §2; keep S22's classify/last-error plumbing for cross-user dead-lettering.
- **`src/main.tsx`** *(or existing boot orchestration)* — invoke `backfillCapturedByUserIdForPendingPhotos()` once after auth bootstrap.

### Out of scope

- Multi-account "switch user but keep my queued work" UX (would require a true per-user IDB partition; far larger).
- Re-attributing already-uploaded photos in Storage (this fix prevents the bad write; it doesn't undo prior misattribution).
- Surfacing capture-time user in the photo gallery UI.

### Risk

Low.
- New field is optional; legacy records flow through the migration helper or fall through to dead-letter, never silently misattributed.
- The dead-letter UI from S22 already exists, so cross-user photos get a visible Retry/Discard control instead of vanishing.
- Capture-time path now requires an extra `getUserWithCache()` call on stage; already cached, sub-millisecond.

### Verification

- `npx tsc --noEmit`.
- Unit: extend `src/lib/offline-storage-guards.test.ts` with two cases — (a) `capturedByUserId` matches current user → upload proceeds; (b) mismatch → upload skipped and `lastError` set.
- Manual smoke: sign in as A → capture 1 photo offline → sign out → sign in as B → trigger sync → confirm the photo appears in the diagnostics sheet with `Photo belongs to a different signed-in user`, **not** uploaded under B's tree.

