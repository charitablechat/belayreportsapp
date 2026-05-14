# One-Time Photo Rescue Sweep

Give photos that were dead-lettered or stuck *before* the recent sync hardening exactly one fresh attempt under the new logic, so existing reports' missing pictures get a chance to upload without manual intervention.

## Goals

- Reset eligible dead-lettered / stuck photos so the next sync cycle picks them up.
- Run **once per device** (idempotent via a localStorage marker).
- Touch only photos whose `blob` is still present in IndexedDB (evicted blobs are unrecoverable).
- Skip photos belonging to a different signed-in user (preserves shared-iPad attribution rules).
- Surface the result in the Sync Terminal so the user sees what happened.

## Scope

In scope:
- A new `runPhotoRescueSweep()` helper in `src/lib/sync-manager.ts` (or a sibling file).
- Auto-trigger once on app boot, after auth is confirmed and before the first sync cycle.
- Sync Terminal notification: "Rescue sweep: N photos re-queued".
- Manual "Re-run rescue sweep" button in `SyncDiagnosticsSheet` for support cases.

Out of scope:
- Recovering blobs already evicted by storage pressure (impossible).
- Touching photos whose parent inspection is fully missing from IDB.
- Server-side changes.

## Eligibility rules (per photo)

A photo is rescued if **all** of:
1. `uploaded === 0`
2. `blob` is present (non-null, size > 0)
3. Either `retryCount >= MAX_PHOTO_RETRIES` (dead-lettered) OR matches the "stuck" pattern (`retryCount=0`, `nextRetryAt=null`, `lastError=null`, age > 24h)
4. `capturedByUserId` matches current user OR is null/undefined (legacy untagged)
5. Not already rescued (no `rescuedAt` timestamp on the row)

For each eligible photo:
- Reset `retryCount = 0`, `nextRetryAt = null`, `lastError = null`, `lastErrorAt = null`, `transientCount = 0`
- Stamp `rescuedAt = Date.now()` so the sweep is idempotent and auditable
- Leave `blob`, `inspectionId`, `capturedByUserId`, `photoUrl` untouched

Also clear matching rows from the `photo_upload_failures` quarantine table reference (IDB-side mirror only — server quarantine is left alone; a successful re-upload will naturally supersede it).

## Trigger

- **Auto**: Once per device, gated by `localStorage['photo-rescue-sweep-v1-completed']`. Runs in `useAutoSync` mount effect after `getUserWithCache()` resolves and before `performSync`.
- **Manual**: Button in `SyncDiagnosticsSheet` ("Re-run rescue sweep") — clears the localStorage marker and re-runs. Useful for support.

## UX

- After the sweep, dispatch a `addSyncNotification`:
  - `"Rescue sweep complete: N photos re-queued for upload"` (info)
  - Or `"Rescue sweep: no eligible photos found"` (silent / dev-only)
- The next sync cycle then handles them through the normal pipeline (with the new BLOCKED bucket, transient cap, and 24h escalation already in place).

## Technical details

```text
Boot
  └─ useAutoSync mount effect
        ├─ await getUserWithCache()
        ├─ if (!localStorage['photo-rescue-sweep-v1-completed'])
        │     ├─ runPhotoRescueSweep(userId)
        │     │     ├─ open IDB readwrite tx on 'photos'
        │     │     ├─ scan by-uploaded=0 index
        │     │     ├─ filter by eligibility rules
        │     │     ├─ reset counters + stamp rescuedAt
        │     │     └─ return { rescued: number, skippedNoBlob: number }
        │     ├─ localStorage.setItem('photo-rescue-sweep-v1-completed', isoNow)
        │     └─ addSyncNotification(...)
        └─ performSync (now picks up rescued photos)
```

Schema additions (non-breaking; both optional):
- `photos.rescuedAt?: number` — informational, no index needed
- No IDB version bump required (optional fields don't trigger migration)

Files to touch:
- `src/lib/offline-storage.ts` — add `rescuedAt?: number` to the photo type; export `runPhotoRescueSweep` or expose a helper
- `src/lib/sync-manager.ts` (or new `src/lib/photo-rescue-sweep.ts`) — implement the sweep
- `src/hooks/useAutoSync.tsx` — wire the boot trigger
- `src/components/pwa/SyncDiagnosticsSheet.tsx` — add manual re-run button + last-run timestamp
- `src/lib/__tests__/photo-rescue-sweep.test.ts` — eligibility rules + idempotency

## Risks / mitigations

- **Re-uploading a photo the server already has** → already handled by `success-equivalent` 409 dedup classification (covered in last round of fixes).
- **Mass re-queue overwhelming the network** → bounded by existing `runWithConcurrency` (3 mobile / 5 desktop) and the per-user batch caps.
- **Running on a device with someone else's photos** → eligibility rule #4 (attribution check) prevents cross-user re-queue.
- **Running twice** → localStorage marker + `rescuedAt` stamp; second run is a no-op.
