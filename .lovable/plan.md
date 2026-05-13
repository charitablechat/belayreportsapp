
# Photos Won't Persist on Tablet — Audit Plan

## What we actually know

From the screenshots: dashboard shows **"Syncing your data…"** with **"57 pending"** in amber, then a **"syncing…"** flash. So the device:
- has network (sync is actively trying)
- has 57 unsynced **records** queued (the badge counts inspections + trainings + daily assessments — *not* photos directly; see `useAutoSync.tsx:935-969` and `Dashboard.tsx:1804`)
- the sync loop is running but the count is not draining

Photos "exist locally but don't persist" is therefore most likely a **secondary symptom** of the parent records being stuck. `syncPhotos` deliberately *skips* any photo whose parent inspection still has a `temp-` ID (`sync-manager.ts:192-230`) — and it does so without bumping `retryCount`, so those photos sit in the queue forever as long as the parent never gets a real UUID.

We do not yet have runtime logs from this specific tablet, so step 1 is targeted diagnostics, step 2 is the most likely fixes.

## Suspected root causes (ranked)

1. **Parent records stuck on `temp-` IDs (most likely).** A validation error, RLS denial, or transient network failure on the parent record blocks the UUID swap. Photos under that parent are skipped every cycle and never drain. The "57 pending" badge confirms parents are queued.
2. **Storage RLS path mismatch.** If `auth.uid()` differs from the first segment of the photo's storage path (offline-placeholder session, shared-device residue, or an old `pending/` photo with no attribution) the upload returns RLS-denied. The defensive re-key at `sync-manager.ts:418-449` covers some cases but not all.
3. **Photos held in jittered backoff (`nextRetryAt`) far in the future.** A burst of co-failures (e.g. brief Wi-Fi glitch) can park dozens of photos in long backoff windows; they show as pending but the pipeline won't actually retry them until the timer elapses.
4. **`syncPhotos` aborted by `assertRealSessionForSync`.** Note the records-side calls at `atomic-sync-manager.ts:1557 / 2618 / 3522` — but **`syncPhotos` itself does not call `assertRealSessionForSync`**. If the tablet is on an offline placeholder session, records would be blocked while photos would attempt upload with no real JWT and get 401'd.
5. **Blob lost via storage-pressure eviction.** Tablets with low free storage may evict blobs; the dead-letter path at `sync-manager.ts:361-391` handles this but the count would have already drained — unlikely to be the cause of "57 stuck".

## Step 1 — Land lightweight diagnostics (no behavior change)

Add structured logs the user's tablet will start emitting on its next sync cycle so we can see exactly where the queue is jamming. All single-line, throttled to once per cycle.

In `src/lib/sync-manager.ts → syncPhotos()`:
- Log a one-line cycle summary: `total / withTempParent / inBackoffWindow / retrySaturated / readyToUpload`.
- For the first 3 photos that get skipped because of `temp-` parent, log the parent ID, last sync error, and `updated_at` so we can see *why* the parent isn't promoting.

In `src/hooks/useAutoSync.tsx → doUpdateUnsyncedCounts`:
- When the count is non-zero, log a one-line breakdown: `inspections=N trainings=N daily=N` and how many of each are still on `temp-` IDs.

In `src/lib/atomic-sync-manager.ts`:
- Tag every record-sync failure with a stable `[stuck-record]` prefix and include `recordId`, `tempIdRetained: boolean`, and the classified error category so they're easy to grep / filter in Sentry.

These logs cost nothing in steady state and immediately tell us which of the four root causes is firing on this tablet.

## Step 2 — Targeted fixes (apply only the ones diagnostics confirm)

### Fix A — Parent record stuck on `temp-`
- If a record fails N consecutive sync cycles for the *same* validation/RLS reason, surface it explicitly in the SyncPulse Sync Terminal as **"BLOCKED — tap to inspect"** with the underlying error string, instead of letting it sit silently in the pending count.
- Add a one-cycle pre-flight that re-reads the parent from IDB before `syncPhotos` runs and dead-letters photos whose parent has been continuously `temp-` for > 24 h with a non-transient error class. (Keeps the badge accurate; user can re-open the parent record to fix the underlying field.)

### Fix B — Add `assertRealSessionForSync` to `syncPhotos`
Mirror the records pipeline. If the device is on the offline placeholder session, `syncPhotos` should no-op the upload step instead of attempting Storage PUTs with a placeholder JWT (which always RLS-deny and burn `nextRetryAt` backoff).

### Fix C — Bound `nextRetryAt` jitter and add manual reset
Cap the backoff at a sensible ceiling (e.g. 5 min) so a burst of failures can't park photos in 30+ min windows. Wire SyncPulse's "Retry Now" to clear `nextRetryAt` on every photo, not just clear the session quarantine set.

### Fix D — Photo storage-RLS pre-flight
Before the per-photo loop in `syncPhotos`, run the existing `storage-rls-probe` once per cycle with the active `auth.uid()`. If it fails, surface a single "Storage permission denied — contact admin" toast and skip the cycle, rather than 57 individual upload attempts that each look like transient errors.

## Step 3 — Verify

1. Add a Vitest case proving `syncPhotos` no-ops when only the placeholder session is available (Fix B).
2. Add a fake-IDB test proving photos with a `temp-` parent older than 24 h with a permanent error get dead-lettered (Fix A).
3. Add a unit test on the `nextRetryAt` cap (Fix C).
4. Manually verify on the user's tablet (one online sync cycle) that the new diagnostic line shows up in the console and the breakdown matches the failure mode we expect.

## Risk assessment

- **Diagnostics (Step 1)** — zero risk; pure logging.
- **Fix A (dead-letter long-stuck temp parents)** — low risk; parents older than 24 h with non-transient errors are by definition not draining on their own. The user already loses nothing because the photo blob remains in IDB and surfaces in the dead-letter UI for manual recovery.
- **Fix B (`assertRealSessionForSync` in `syncPhotos`)** — very low risk; mirrors an established pattern. Worst case is one extra sync cycle delay before photos upload after a real session arrives.
- **Fix C (`nextRetryAt` ceiling)** — low risk; only changes the retry cadence on already-failing photos.
- **Fix D (storage RLS pre-flight)** — medium risk; a flaky probe could falsely block a sync cycle, so it must be lenient (only skip when the probe returns a definitive RLS denial, never on transient network errors).

## What I will NOT change in this plan

- The core `getUnsynced*` filter pipeline (already audited, contract-locked by tests).
- The C1 boolean-index contract on `photos.uploaded`.
- The "trust then verify" offline-auth model.
- Anything in PWA install / service-worker layers (separate from sync).

## Deliverable order

1. Land Step 1 diagnostics so we collect logs from the tablet on its next online cycle.
2. Wait one cycle, read the logs, then apply the 1–2 fixes the diagnostics actually point at.
3. Add the regression tests alongside whichever fix(es) ship.

This avoids shotgunning four fixes when one targeted fix is the real answer.
