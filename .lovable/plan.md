
# iPad Sync Backlog Audit & Solution

## What the screenshots actually show

1. **iPad screenshot (46 pending, "iPad and iPhone don't support background syncing")** — this banner is rendered by `BackgroundSyncStatus.tsx` and is **expected behavior**. Service Worker Background Sync is permanently disabled in this app (see `src/lib/background-sync.ts`: `isBackgroundSyncSupported()` returns `false`). All sync runs main-thread inside `useAutoSync` while the tab is foregrounded. iOS Safari aggressively suspends background tabs, so when the user locks the iPad or switches apps, sync pauses. **This part is by design and not a bug.**

2. **Both screenshots (37 / 46 pending that don't drop)** — a backlog this large that doesn't drain while the user keeps the app open IS a real issue. It means one or more of the silent-skip pipelines below is holding work back.

## Root-cause audit — where pending items actually go

The "pending" badge sums `getUnsyncedInspections + Trainings + DailyAssessments + UnuploadedPhotos`. Records can sit in this count cycle after cycle if any of these is true:

| Bucket | Where | Why a user sees it stuck |
|---|---|---|
| **A. Session-quarantined records** | `sync-quarantine.ts` (sessionStorage). 3 consecutive *persistent* (non-network) failures → quarantined until end-of-day local. | Already filtered OUT of the user-facing count by `getUnsynced*` (memory: `unsynced-counts-coalescer`). Surfaced in SyncPulse Sync Terminal as `QUARANTINED N — Retry Now`. ✅ correct. |
| **B. Regression-skip held-back records** | `regression-skip-store.ts`, `MAX_REGRESSION_SKIPS = 3`. Triggered when payload would shrink an inspection by >50%. | Skipped silently for ≤3 cycles, surfaced as `HELD_BACK N` in SyncPulse + actionable in `SyncDiagnosticsSheet`. ✅ correct, but invisible from the dashboard banner. |
| **C. Photo dead-letter** | `MAX_PHOTO_RETRIES = 5` in `offline-storage.ts`. | Surfaced as "Failed photos" with Retry button. ✅ |
| **D. Photo backoff window** | `nextRetryAt` (`jitteredPhotoBackoffMs`, attempt 5+ caps at 5 min). | Photo IS unsynced but `getUnuploadedPhotos` filters by `nextRetryAt <= now`. So a photo can be inside the badge total but skipped this cycle — it WILL drain. ✅ |
| **E. Photos stuck on `temp-…` parent** | Photos whose `inspectionId` is still a temp-ID because parent never synced. Each cycle bumps retryCount until dead-letter, then 30-day GC. | Currently emits no targeted UI signal until dead-letter. ⚠️ This is the most likely culprit on this user's device — a single un-syncable inspection can hold 20–40 photos hostage. |
| **F. Cross-user / orphan records** | `getUnsynced*` ownership filter (`inspector_id === userId OR id startsWith 'temp-'`). | Shared-device temp records owned by another user surface in the count but never actually sync for the current user. Audit memory `unsynced-counts-coalescer`. ⚠️ |
| **G. JWT / RLS rejection** | `validatedUser` falls through to cached JWT (Mode 7C). If the cached JWT is silently expired, every POST 401s, atomic-sync classifies transient, retries forever. | Visible only in console. ⚠️ |
| **H. Storage quota near full** | iOS Safari aggressively evicts IDB at quota. `manageStoragePressure()` runs post-sync; if quota is already exhausted, writes silently fail. | Surfaced as `idbReadError`, but if writes never reached the queue we never know. ⚠️ |
| **I. Day-boundary quarantine** | `endOfDay` is local-time. So a user working past midnight gets a clean slate. Already handled. ✅ |

The user's symptom — a constant "37 / 46 pending" that doesn't move with the app open — most likely lives in **E (temp-parent photos)**, **F (orphan/cross-user records)**, or **G (silent JWT failure)**. Today none of these has a surfaced count or a one-tap remediation in the main UI; they only show up if the user opens **Profile → Sync Diagnostics**, which most users won't.

## Solution — make the backlog explainable AND drainable

### 1. Diagnostic edge function: `sync-self-check`
A new edge function the user can run from `SyncPulse` "RUN SELF-CHECK" that, with the user's JWT:
- Verifies the JWT is real (not synthetic placeholder).
- Probes RLS by attempting a 1-row select on `inspections`, `trainings`, `daily_assessments`, `inspection_photos`, plus a HEAD on the photos bucket.
- Returns a structured `{ jwt: ok|expired|synthetic, rls: {table: ok|denied}, storage: ok|denied, serverNow: epoch }` payload.

Result is rendered in the Sync Terminal as a 4-line readout. Catches buckets G + H without dev tools.

### 2. New IDB readers for the silent buckets, exposed in `usePWA`
Add to `useUnsyncedPhotos` (or a sibling hook):
- `tempParentPhotoCount` — photos whose `inspectionId.startsWith('temp-')` AND retryCount < 5.
- `orphanRecordCount` — unsynced inspections/trainings/assessments where `inspector_id !== currentUserId` AND `id.startsWith('temp-')` (cross-user shared-device leftovers).

Surface as new rows in SyncPulse Sync Terminal:
```text
TEMP_PARENT_PHOTOS   12   [VIEW]
ORPHAN_RECORDS        4   [REASSIGN] [DELETE]
```
Tapping `REASSIGN` rewrites `inspector_id` to current user (with confirm). Tapping `DELETE` removes locally with confirm. This is the primary unblock for the screenshot's symptom.

### 3. Per-record reason column in SyncPulse "Pending reports" list
Today the list shows `INS organization @ location`. Append a one-token reason chip when the record is being skipped:
- `RETRY` — inside backoff window
- `TEMP_PARENT` — child photos blocking
- `RLS?` — last attempt 401/403
- `BIG_DROP` — held back by regression guard
- `(blank)` — will sync this cycle

This requires `atomic-sync-manager` to stamp `last_skip_reason` + `last_skip_at` on the IDB row when it skips/fails. No new tables.

### 4. iPad-specific guidance band
Inside `BackgroundSyncStatus.tsx`, when `isIOS() && unsyncedCount > 10 && isOnline && !isSyncing`, append a second short line:
> "If this number isn't decreasing, tap the sync dot at the top to open the Sync Terminal and run Self-Check."

Plus add a deep-link button: "Open Sync Terminal".

### 5. Hard-stop on silent JWT failure
In `performSync`, when 3 consecutive cycles produce 0 successes AND >0 attempted, force a `supabase.auth.refreshSession()` AND if that fails, surface a fatal-severity sync error (currently we only surface `'soft'` for stats hiccups). User sees red SYNC FAILED with "Session expired — sign in again" instead of an indefinite amber count.

### 6. One-time integrity sweep on login
On successful sign-in, run a single-pass IDB audit:
- Re-stamp `inspector_id` of any `temp-…` records whose `cached_profile.user_id === currentUserId` but whose `inspector_id` is stale (handles the cross-device same-account case).
- Force `nextRetryAt = null` on photos whose parent ID was just resolved (so a backed-off photo doesn't sit through 5 minutes after the parent finally synced).

This drains exactly the cohort the user is staring at — temp orphans + photos waiting on a now-resolved parent.

### 7. Tests
- `src/lib/__tests__/sync-self-check.test.ts` — happy path + each failure mode.
- `src/lib/__tests__/temp-parent-photo-count.test.ts` — fake-indexeddb fixture with mixed temp/UUID photos.
- `src/lib/__tests__/orphan-record-detection.test.ts` — cross-user temp records.
- `src/components/pwa/__tests__/SyncPulse.diagnostics.test.tsx` — terminal renders new rows + reassign/delete actions call through.
- Extend existing `unsynced-read-boundary.test.ts` to assert temp-parent photos still count toward badge but are surfaced separately.

## Out of scope (explicitly NOT changing)
- The "iPad and iPhone don't support background syncing" banner copy — it is accurate. We're adding a second informational line and a deep-link, not removing the banner.
- The 5-retry / 3-strike thresholds — these are tuned and changing them would mask real failures.
- Service Worker background sync — permanently disabled by design (no JWT in SW context).

## Technical notes
- Edge function `sync-self-check` follows existing `verify_jwt = true` pattern; uses the caller's JWT, never service role.
- New IDB queries reuse `withIDBTimeout` + `IdbReadFailure` boundary so they can never zero the badge.
- `last_skip_reason` is a free-text local-only field — strip via `strip-local-only-upsert-fields.ts` before any upsert.
- Reassign action goes through `saveInspectionOffline`/`saveTrainingOffline` so the dirty flag + sync trigger are stamped correctly.
- All UI additions reuse the SyncPulse retro-tech terminal styling; no new design tokens.
