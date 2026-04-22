

## Why the orange "3 pending" dot won't clear

The "3" lives on the SyncPulse dot and on the cloud chip, both of which display `totalUnsynced = unsyncedCount + unsyncedPhotoCount`. Both numbers are computed from IndexedDB by *separate* queries with *different* "still pending" rules. After last cycle's drift fix, `unsyncedCount` (reports) is reliable. The leftover phantom is now coming from **`unsyncedPhotoCount`** — and there are 3 specific reasons photos can sit in IDB forever as "pending" with nothing the auto-sync loop can do about them.

### Root cause #1 — Photos that exhausted retries stay "uploaded: false" forever

`syncPhotos` (`src/lib/sync-manager.ts:68`) filters out any photo whose `retryCount >= MAX_PHOTO_RETRIES (5)` and **never touches them again**. They keep `uploaded: false` and a non-null `blob`, so `getUnuploadedPhotos` (`src/lib/offline-storage.ts:1274`) keeps returning them in every count cycle. Every periodic sync silently skips them; every count refresh re-reports them as "pending." This is the number-one source of permanent ghost pendings — a single failed upload (network blip on first try, RLS hiccup, blob corruption) becomes a permanent "X pending" badge after 5 quick retries.

### Root cause #2 — Photos pointing at orphaned/temp inspections

`syncPhotos` also early-returns for any photo whose `inspectionId` starts with `temp-` (line 97–101). If an inspection was created offline, then deleted before it ever synced, its photos remain in IDB pointing at the dead temp-ID. They will never upload — there's no parent row to attach them to — but they keep counting toward `unsyncedPhotoCount` forever.

### Root cause #3 — Photos with null blob that aren't marked uploaded

A partial success path exists where the storage upload succeeds but the DB insert fails (or the page navigates mid-upload). `markPhotoAsUploaded` sets `blob = null`. The `getUnuploadedPhotos` query at line 1285 filters those out (`p.blob != null`), so they won't show. **But** if a photo got its blob nulled by a different path (e.g., storage-pressure eviction touching the wrong record, or a quota trim) without setting `uploaded = true`, it would slip through this filter — actually we're safe here, the filter handles it. Discount this one.

### Root cause #4 — `unsyncedPhotoCount` never refreshes on its own

`useUnsyncedPhotos` (`src/hooks/useUnsyncedPhotos.tsx`) only recomputes the count when:
- the hook mounts, or
- `useAutoSync` dispatches `sync-photos-updated` after a successful sync cycle.

If the periodic sync skips the heavy pipeline (the "early exit" path at `useAutoSync.tsx:271` when `hasUnsyncedItems = unsyncedCountRef.current > 0` is false but `unsyncedPhotoCount` is non-zero), the `sync-photos-updated` event never fires, and even after photos are silently abandoned, the count stays stuck for the entire session. The HP has been on all day — no remount, no event — so the badge never re-evaluates.

### What to fix

**P1 — Stop counting permanently-failed photos as "pending"** *(the actual bug fix)*

In `getUnuploadedPhotos`, add a filter that excludes photos with `(retryCount || 0) >= MAX_PHOTO_RETRIES` and photos whose `inspectionId` starts with `temp-` and the parent inspection no longer exists in IDB (orphan check via `db.get('inspections', photo.inspectionId)`). Move `MAX_PHOTO_RETRIES` to a shared constant exported from `offline-storage.ts` so the count and the sync loop agree. Photos in this state are effectively dead — they should not light up the badge.

These photos are still preserved in IDB (not deleted) so admins can recover them via the Data Recovery panel. They just stop polluting the live counter.

**P2 — Surface dead-letter photos in the SyncPulse sheet**

When the SyncPulse dialog opens, count "skipped" photos (`retryCount >= MAX || orphaned temp parent`) separately and show them under a new `FAILED_PHOTOS` row with a "Retry" action that resets `retryCount` to 0 and triggers a sync. This keeps visibility without keeping a fake "pending" number on screen 24/7.

**P3 — Photo count needs its own refresh trigger**

In `useAutoSync.performSync`, also dispatch `sync-photos-updated` from the early-exit branch (line 271–280) and the finally block (line 469). Right now the event only fires after a full pipeline run. Add a 5-minute background tick in `useUnsyncedPhotos` as a safety net (cheap — single index query) so the badge self-corrects even if no sync runs.

**P4 — One-time cleanup on app boot**

On first load after this update, run a single migration pass that:
- resets `retryCount = 0` on every photo (gives previously-dead photos one fresh chance to upload), then
- after the next sync cycle, photos that still fail will hit the new MAX cap and drop off the badge.

This guarantees the user's currently-stuck "3" goes away within one sync cycle without losing any data.

### Files to change

- `src/lib/offline-storage.ts` — export `MAX_PHOTO_RETRIES`, update `getUnuploadedPhotos` to exclude exhausted/orphaned photos, add `getDeadLetterPhotos` for the sheet, add `resetPhotoRetryCounts` for boot migration.
- `src/lib/sync-manager.ts` — import the shared `MAX_PHOTO_RETRIES` constant.
- `src/hooks/useUnsyncedPhotos.tsx` — add a 5-minute interval as a safety net; expose `deadLetterCount`.
- `src/hooks/useAutoSync.tsx` — dispatch `sync-photos-updated` from the early-exit branch and finally block.
- `src/components/pwa/SyncPulse.tsx` — add a `FAILED_PHOTOS` row with Retry action when dead-letter count > 0.
- `src/main.tsx` (or `App.tsx` boot path) — one-time `resetPhotoRetryCounts()` call gated by a `localStorage` flag so it runs once per device.

No DB migrations, no edge functions. ~80 LOC net.

### Risk

- **P1:** Photos stuck at retry cap stop counting. They're not deleted, just hidden from the live badge. Recoverable via the new Retry action in the sheet.
- **P4:** Resetting retry counts gives every previously-failed photo one more upload attempt on next sync. If a photo is genuinely broken (corrupt blob), it'll fail 5 more times and drop off again. Worst case is 5 short bursts of upload errors in the console, then quiet.
- **P2/P3:** Pure UI/event-dispatch changes, no data path touched.

### Expected outcomes

- HP's "3 pending" badge clears within one sync cycle after this ships.
- Future photo-upload failures stop becoming permanent ghost counters.
- Power users can see and manually retry failed photos from the SyncPulse sheet instead of reporting "still 3 pending" three weeks later.

### Verification

1. HP after deploy: badge "3" → boot migration resets retries → next sync runs → genuinely-uploadable photos upload → unrecoverable photos hit cap → badge drops to 0 within 60s.
2. Open SyncPulse sheet → dead-letter photos (if any) appear under FAILED_PHOTOS with a Retry button.
3. Click Retry → retry counts reset → sync runs → photos either succeed (remove from list) or fail back to dead-letter.
4. Create a new photo offline → reconnect → photo uploads → count goes to 0 (no regression).
5. Delete an unsynced inspection that has photos → its orphaned photos stop counting toward the badge.
6. Leave HP idle for an hour → 5-min safety tick keeps the count in sync with reality.
7. Existing report-pending logic from the previous cycles unchanged (still uses 5s drift tolerance, still re-aligns on Realtime).

