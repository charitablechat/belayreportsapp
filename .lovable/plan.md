# iPad Sync Backlog — Diagnose & Drain

The iPad shows 46 pending syncs that don't drop. The audit identified four real-world causes that the current UI cannot distinguish, so users (and we) can't tell "still working" from "permanently stuck."

## Root causes (from audit)

1. **Temp-parent photo lock-up** — Photos whose `inspectionId` still starts with `temp-` get counted in the badge but skipped each cycle (filtered by `nextRetryAt`). One un-syncable inspection holds 20–40 photos hostage.
2. **Orphan / cross-user records** — `getUnsynced*` surfaces records owned by other users or whose `inspector_id` no longer matches `auth.uid()`. They inflate the badge forever.
3. **Silent JWT failure** — Cached JWT path (Mode 7C) keeps POSTing 401s; atomic-sync classifies them as transient and retries indefinitely. Visible only in console.
4. **iOS storage-quota eviction** — `manageStoragePressure()` fails silently when iOS Safari evicts IDB pages.

## What we'll build

### 1. New IDB readers + actions in Sync Terminal (primary unblock)
- `tempParentPhotoCount` and `orphanRecordCount` exposed via `usePWA`.
- SyncPulse "Sync Terminal" panel adds two rows with `REASSIGN` (rewrites `inspector_id` to current user, with confirm) and `DELETE` (removes locally, with confirm) actions.

### 2. `sync-self-check` edge function + "RUN SELF-CHECK" button
- Verifies JWT validity and probes RLS for `inspections`, `trainings`, `daily_assessments`, `*_photos`.
- Returns structured report (`jwt_ok`, `rls_ok_per_table`, `clock_skew_ms`).
- Surfaced in SyncPulse as a one-click diagnostic — catches causes #3 and #4 without dev tools.

### 3. Per-record skip-reason chip in pending list
- `atomic-sync-manager` stamps `last_skip_reason` (`RETRY`, `TEMP_PARENT`, `RLS?`, `BIG_DROP`) and `last_skip_at` on IDB rows.
- SyncPulse pending list shows the chip so each stuck row is explainable.

### 4. iPad guidance band in `BackgroundSyncStatus`
- Second informational line on iOS-Safari that deep-links to the Sync Terminal.
- Existing "iPad/iPhone don't support background syncing" banner stays — it's accurate.

### 5. Hard-stop on silent JWT failure
- 3 consecutive sync cycles with 0 successes → force `supabase.auth.refreshSession()` and surface a fatal-severity error in SyncPulse instead of retrying forever.

### 6. One-time login integrity sweep
- On login: re-stamp `inspector_id` on stale `temp-…` records owned by current user; clear `nextRetryAt` on photos whose parent inspection ID was just resolved.
- Idempotent; runs once per session.

### 7. Tests
- `sync-self-check.test.ts`
- `temp-parent-photo-count.test.ts`
- `orphan-record-detection.test.ts`
- `SyncPulse.diagnostics.test.tsx`
- Extended `unsynced-read-boundary.test.ts`

## Out of scope
- Changing 5-retry / 3-strike thresholds.
- Re-enabling Service Worker background sync (permanently disabled by design on iOS).
- Schema changes to server-side tables.

## Technical notes
- All new IDB writes go through existing `offline-storage` helpers — no schema bump.
- `last_skip_reason` is local-only metadata, never synced.
- `sync-self-check` uses `verify_jwt = true` (default) and the caller's session; no service role.
- No credentials added to frontend; reuses existing `supabase` client.
- Realtime presence and existing sync-lock semantics unchanged.

## Expected outcome
After this lands, every number in the badge is either (a) actively retrying, (b) explainable via a skip-reason chip, or (c) actionable via REASSIGN/DELETE. The iPad backlog drains or is consciously cleared — no more silent stuck state.
