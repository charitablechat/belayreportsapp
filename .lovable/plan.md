

## Why the HP shows "3 pending" forever and the iPad never sees the updates

These are two faces of the same root cause: **inconsistent timestamp-drift thresholds across the app.** The "Solid Rock Camp" inspection gets stuck in a state where one device thinks it's dirty (and keeps "syncing" it endlessly) while another device thinks its stale local copy is newer than the server.

### Root cause: three different drift thresholds for the same question

The codebase asks the same question — "is local data newer than what's been synced?" — in three places, with three different answers:

| Location | Threshold | Used by |
|---|---|---|
| `local-data-guards.ts` → `isLocalDataNewer` | **0 ms** (strict `>`) | `InspectionForm.loadInspection` decides which copy wins |
| `local-data-guards.ts` → `shouldPreserveLocalRecord` | **5 000 ms** (`CLOCK_SKEW_TOLERANCE_MS`) | Dashboard cache write |
| `offline-storage.ts` → `getUnsyncedInspections` / `getUnsyncedCounts` | **2 000 ms** | Pending-count badge & sync trigger |

When the HP syncs the inspection, `align_synced_at` writes back `synced_at` = `updated_at` from the server. But Postgres' `updated_at` trigger and the client's local `updated_at` (set with `new Date()`) can diverge by a few milliseconds because of clock skew, network round-trip, and the trigger's own timing. The local `saveInspectionOffline` call at `atomic-sync-manager.ts:659–664` overwrites both fields with `serverTimestamp`, which *should* zero out the drift — but only on records that synced through that specific path on this session. Records loaded from the dashboard cache, or partially merged via Realtime, end up with an `updated_at` that's 2–4 seconds ahead of `synced_at`.

The **2-second** filter in `getUnsyncedCounts` then sees that drift as "needs sync." The sync runs, succeeds, calls `align_synced_at` again, and the same drift reappears on the next Realtime echo (because the post-sync cooldown clears in 10 s, and another field-merge nudges `updated_at`). Result: the pending count never goes to zero on the HP. That's exactly what the screenshot shows — the "3 pending" badge that won't clear.

Meanwhile on the iPad, `InspectionForm.loadInspection` calls `isLocalDataNewer(offlineData, data)` — the **0 ms** version. The iPad's local copy has `updated_at` = its last edit (older than the HP's edits) and `synced_at` from a previous session. As soon as the iPad's `updated_at` is later than the server's `data.updated_at` by even 1 ms — which it is, because the iPad never synced its trivial keystroke from yesterday — the function returns `true` and the form **discards the freshly-fetched server payload and shows the stale local copy**. The "Solid Rock Camp" form on the iPad therefore never reflects the HP's edits, even though the network call succeeded and the server response is correct.

### Secondary contributors

1. **`saveInspectionOffline` after `align_synced_at` doesn't include child-row sync state** (`atomic-sync-manager.ts:659`). If a child row (system/zipline/equipment) was added during the sync window, the parent's `updated_at` advances locally on the next save while `synced_at` stays at the server-aligned timestamp → drift > 2 s → reappears in unsynced count.
2. **No "synced this session" suppression** in the unsynced-counts query. Records that just succeeded their `align_synced_at` call get re-counted on the next 30-second tick because Realtime echoed back our own write and bumped `updated_at` again.
3. **Realtime UPDATE handler doesn't bypass `isLocalDataNewer`** for the form view. When the iPad receives a Realtime UPDATE for an inspection it has open, it persists the payload to IndexedDB, but the open form keeps showing the old in-memory state — and a route change/refresh re-triggers `isLocalDataNewer` which still picks the stale local copy.

### Fix plan

**F1 — Unify the drift threshold (the actual bug)**

Define a single exported constant `SYNC_DRIFT_TOLERANCE_MS = 5000` in `local-data-guards.ts` and use it everywhere:

- `isLocalDataNewer`: require `(localUpdatedAt - serverUpdatedAt) > SYNC_DRIFT_TOLERANCE_MS` instead of strict `>`. This stops the iPad from preferring its 1-ms-newer local copy over a real server update.
- `getUnsyncedInspections`, `getUnsyncedCounts`, `getUnsyncedTrainings`, and the assessments equivalent: replace the hard-coded `2000` with `SYNC_DRIFT_TOLERANCE_MS`. This stops the HP's "3 pending" badge from re-arming on its own clock skew.
- `shouldPreserveLocalRecord`: already uses 5 s; switch to the shared constant.

Net effect: drifts under 5 s are treated as "already in sync" by every code path, so a record can no longer be "pending" to one query and "in sync" to another.

**F2 — Server timestamp wins when within tolerance**

In `isLocalDataNewer`, when `|localUpdatedAt - serverUpdatedAt| <= SYNC_DRIFT_TOLERANCE_MS` AND `localRecord.synced_at` is non-null, return `false` unconditionally. This forces the iPad to accept the server's payload whenever it's plausibly the same logical version, eliminating the "stuck on stale local copy" failure mode.

**F3 — Re-align on Realtime UPDATE, not just on local sync**

In `useAutoSync.handleRemoteChange`, when persisting a Realtime payload to IndexedDB, also overwrite the local `synced_at` with the payload's `updated_at`. Right now we only re-align `synced_at` after a local push via `align_synced_at`; pulled remote updates leave `synced_at` at its old value, which is what creates the drift > 2 s the unsynced query catches.

**F4 — Form-level Realtime refresh**

In `InspectionForm`, subscribe to `postgres_changes` for the open inspection's `id`. On UPDATE, if the payload's `updated_at` is newer than the in-memory state's `updated_at` by more than `SYNC_DRIFT_TOLERANCE_MS`, **re-run `loadInspection()`** so the iPad picks up the HP's edits without a manual refresh. Suppress the refresh during the user's own typing (use the same `lastSyncCompletedAtRef` cooldown pattern already in `useAutoSync`).

**F5 — Diagnostic log**

Add a single log line in `getUnsyncedCounts` when a record is flagged unsynced: include `id`, `localUpdated`, `localSynced`, and `drift_ms`. This makes "phantom pending" reproducible from the field — next time a user reports "X pending forever," we can see exactly which record and exactly which drift.

### Files to change

- `src/lib/local-data-guards.ts` — F1 (export shared constant) + F2 (tolerance gate in `isLocalDataNewer`)
- `src/lib/offline-storage.ts` — F1 (replace `2000` with shared constant in 3 functions) + F5 (drift log)
- `src/hooks/useAutoSync.tsx` — F3 (re-align `synced_at` on Realtime UPDATE)
- `src/pages/InspectionForm.tsx` — F4 (subscribe to inspection's Realtime channel and re-load on remote UPDATE)
- `src/pages/TrainingForm.tsx`, `src/pages/DailyAssessmentForm.tsx` — F4 (same Realtime-refresh pattern, copy from inspection)

No DB migrations. No edge functions. ~80 LOC net.

### Risk

- **F1/F2:** Loosens "what counts as dirty" from 2 s to 5 s. A record edited locally and then quickly re-edited (within 5 s) without an intervening sync would still register as dirty because `synced_at` would be unset for the second edit. Genuine offline edits push drift well above 5 s. No realistic edit scenario is missed.
- **F3:** Re-aligning `synced_at` from a Realtime payload assumes the payload is canonical. It is — Realtime fires after the server commit. Worst case during a network blip: we overwrite `synced_at` with a slightly older timestamp, the next local edit will still flag the record as dirty (because `updated_at` advances), and sync runs. No data loss.
- **F4:** Adds one Realtime subscription per open form. Channel pool has plenty of headroom. Suppressed during local typing to avoid clobbering in-progress edits.
- **F5:** Pure logging.

### Expected outcomes

- HP "3 pending" badge clears within one sync cycle and stays at 0.
- iPad opening "Solid Rock Camp" reads the server's latest payload, not its stale local copy.
- iPad with the form already open receives the HP's edits via Realtime and refreshes within a second.
- Phantom-pending state cannot recur because every code path uses the same drift tolerance.

### Verification

1. On HP: edit Solid Rock inspection → save → wait for sync → pending count goes to 0 and stays at 0 across 3 successive 30-second sync ticks.
2. On iPad (form closed): open Solid Rock inspection → form shows HP's latest edits, not yesterday's local state.
3. On iPad (form open): HP edits a field → within ~1 s the iPad form re-loads showing the HP's value.
4. Pull the iPad's network → edit a field locally → reconnect → sync runs once, pending count goes to 0, no infinite re-sync loop.
5. New diagnostic log appears in console with `drift_ms` for any record briefly considered unsynced.
6. Existing offline edit → reconnect → sync flow still works (drift on a real edit is many seconds, well above the 5 s threshold).

