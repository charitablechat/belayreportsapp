
# Photo Sync Pipeline — Audit Report

Scope: read-only audit. No code changes. Focused on the path "tablet captures photo → IndexedDB → background sync → Supabase Storage + `inspection_photos` row".

## 1. Lifecycle map (current implementation)

```text
PhotoCapture / ItemPhotoUpload
    │  acquireCompressionSlot() (max 2 concurrent, photo-upload-pool.ts)
    │  compressImage / heic-converter
    ▼
IndexedDB `photos` store (offline-storage.ts)
  uploaded: 0|1   retryCount   nextRetryAt   lastError   blob   capturedByUserId
    │
    │  useAutoSync.performSync   (debounced, syncInProgressRef mutex,
    │                              POST_SYNC_COOLDOWN, 3-layer count coalescer)
    ▼
sync-manager.syncPhotos(signal)
  ├─ navigator.onLine guard
  ├─ assertRealSessionForSync('photos')   ← rejects placeholder/guest/expired JWT
  ├─ getUnuploadedPhotos() via by-uploaded=0 index
  ├─ filter retryCount < MAX_PHOTO_RETRIES (5)
  ├─ skip nextRetryAt > now (jittered backoff window)
  ├─ skip inspectionId.startsWith('temp-')   ← parent not yet promoted
  ├─ runWithConcurrency(batch, 3 mobile / 5 desktop)
  │     ├─ attribution checks (capturedBy vs current user vs parent owner)
  │     ├─ pending/ → user-id/ rewrite (only if attribution matches)
  │     ├─ defensive re-key if path[0] != auth.uid()
  │     ├─ supabase.storage.upload(bucket, blob, { upsert:false })
  │     │     classifyPhotoError → transient | permanent | success-equivalent
  │     ├─ inspection_photos insert (dedup via select-then-insert)
  │     └─ markPhotoAsUploaded → uploaded=1, blob released
  └─ end-of-cycle: addSyncNotification for newlyDeadLettered
```

Defensive layers already in place: `retrying-fetch.ts` (5-attempt jittered backoff for idempotent reads), `stuck-photo-beacon.ts` (Sentry signal for 0,0,null,null pattern), `photo-retry-buckets.ts` (READY/RETRYING/STUCK breakdown for the Sync Terminal), dead-letter quarantine (`photo_upload_failures`), `triggerProbeOnPhotoFailure` (storage-RLS regression probe), `synthetic-session-guard` (refuses to transmit `offline_placeholder_token`).

## 2. Findings

### A. Root-cause candidates for "stored locally, never reaches DB"

Ranked by likelihood given the existing code:

1. **Parent record stuck on `temp-*` ID.** `syncPhotos` deliberately *skips* (does not bump retryCount on) photos whose `inspectionId` starts with `temp-`. If the parent inspection's `syncAllInspectionsAtomic` keeps failing (validation error, RLS denial, network 401), the photos will sit at PENDING forever and never surface as dead-letter. Logged as `[stuck-photo]` with parent's `last_sync_error` but never user-visible unless someone opens the Sync Terminal.

2. **Cross-user attribution dead-letter that looks like "stuck".** When a shared iPad changes hands, photos get dead-lettered with `"Photo belongs to a different signed-in user"`. They show up in `getDeadLetterPhotos()` but the count rolls into `deadLetterCount`, not `unsyncedPhotoCount` — easy for a user to think the badge "cleared".

3. **Synthetic-session JWT guard skipping silently.** `assertRealSessionForSync('photos')` short-circuits with `[Sync Manager] Photos sync skipped — no real session`. If the user is in offline-trust mode (placeholder token) AND an iPad believes it's online, photo sync never runs. Surfaced only as a console warn.

4. **Storage RLS regression mid-day.** First failure triggers `triggerProbeOnPhotoFailure`; classified as transient (5xx-shaped) it re-enters jittered backoff without bumping `retryCount`, so it can loop forever in the RETRYING bucket without ever reaching dead-letter.

5. **No-blob, no-photoUrl** orphans — already handled (saturated retryCount + dead-letter), low risk.

### B. Silent-failure / unhandled-rejection surface

- `syncPhotos`'s outer `catch` returns `{ remaining: 0, changed: 0 }` with only a `console.error`. A throw inside the batch is contained by per-photo try/catch + classify, but a throw inside the *outer* setup block (e.g. `getUserWithCache`) returns success-shaped without surfacing to the caller.
- `useAutoSync` wraps `syncPhotos(signal).catch(e => { console.error(...); return null; })` — the same pattern: failures never escalate to the user-visible toast / Sync Terminal. They only appear if you actively open the console.
- Inside the batch, several `try { ... await persist*(...) } catch (e) { console.warn(...) }` blocks (path re-key, normalized path persist, parent owner lookup) swallow IDB write failures; if `updatePhotoPath` silently fails the next cycle re-keys again, but if `markPhotoAsUploaded` fails after a successful upload (rare but possible under storage pressure) the next cycle would re-upload and rely on `success-equivalent` 409 dedup — which is robust *only* if `upsert:false` actually returns 409 (not 400) for the same exact key. Worth a manual probe.
- `addSyncNotification` for `newlyDeadLettered` runs only at the *end* of `syncPhotos`. If `syncPhotos`'s outer catch fires before that line, the user gets no notification at all even if dead-lettered photos accumulated.

### C. Network lifecycle

- `retrying-fetch.ts` only retries `GET/HEAD/OPTIONS` (correct — Storage `upload` is `POST/PUT` and must not be replayed blindly to avoid double-objects). The single attempt for the storage upload is intentional; this means a one-shot `Failed to fetch` during a Wi-Fi → cellular handoff classifies as `transient` and re-queues with `nextRetryAt` jitter — which is correct, but only if `markPhotoTransientFailure` actually writes. No telemetry today on whether transient bumps land.
- The DB insert (`inspection_photos`) is also `POST` and not retried at the fetch layer. Dedup via `select('id').eq(photo_url).eq(fkColumn)` followed by `insert` is a TOCTOU race under bounded concurrency, but the `unique index on photo_url + photo_section` (per memory) makes the second writer's `23505` map to `success-equivalent`. Safe.
- `assertRealSessionForSync('photos')` import-fails open. Acceptable, but a circular-import regression in `atomic-sync-manager` would silently disable the JWT guard — no visible signal.

### D. Credential exposure

Reviewed: `src/integrations/supabase/client.ts`, `.env`, edge functions, and search for `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, hard-coded JWTs in `src/`. Findings:

- The publishable anon key is the only Supabase credential present in client code (`.env`, `client.ts`). That is correct and safe — RLS plus storage prefix `auth.uid()` gates everything.
- No occurrence of `SUPABASE_SERVICE_ROLE_KEY` in `src/`. Service-role is correctly confined to edge functions only (memory: `system-orchestration-auth-bypass`).
- `synthetic-session-guard.ts` actively refuses to transmit the `offline_placeholder_token` (memory: `sync-session-jwt-guard`).
- No webhook secrets, Make.com keys, or third-party tokens found in `src/`.

**Verdict: no credential exposure in the photo-sync path.** Skip remediation.

## 3. Prioritized recommendations (no code yet — for your approval)

### P0 — User-visible signal for stuck-temp-parent photos
Today these are logged as `[stuck-photo]` console warns. Surface them in the Sync Terminal under a fourth bucket "BLOCKED — parent not synced" so the user (or Belay) immediately sees that the *parent inspection* is the bottleneck, not the photos. Show the parent's `last_sync_error`. Same data the diagnostic block at `sync-manager.ts:193-208` already gathers.

### P0 — Add a "stuck > N hours" escalation
Any photo whose `timestamp` is older than e.g. 24 h while still `uploaded=0` and never dead-lettered should fire a single notification ("3 photos pending > 24 h — open Sync Diagnostics"). Mirrors how `newlyDeadLettered` already escalates. Closes the silent-rotting hole behind every "I thought they uploaded" report.

### P1 — Cap the transient-loop budget
A photo can stay in the RETRYING bucket forever as long as failures classify as transient. Add a *transient-attempt counter* (separate from `retryCount`) that, after e.g. 20 transient cycles, demotes to `permanent` and dead-letters with `lastError = "Repeated transient failures — see Sync Diagnostics"`. Prevents indefinite limbo.

### P1 — Telemetry for the JWT-guard short-circuit
Increment a counter (`syncSkipReason: 'no-real-session'`) the user can see in the Sync Terminal. Today the short-circuit is invisible unless you open the console.

### P2 — Wrap `syncPhotos`'s outer try with a finally that *always* flushes the `newlyDeadLettered` notification, including on outer-catch path. Cheap insurance.

### P2 — One-line probe for `upsert:false` semantics
Verify (manual / test) that re-uploading the same `(bucket, key, blob)` reliably returns 409, not 400. If it ever returns 400, dedup classification breaks and the photo permanently dead-letters. Quick fix in `classifyPhotoError` if needed.

### Out of scope (already solid)
- Concurrency cap (P, photo-upload-pool)
- Retrying-fetch budget (Mode 13A, 5 attempts)
- Photo attribution rules (C6, capturedBy)
- IDB index contract (`uploaded: 0|1`)
- Sync mutex / coalescer (3-layer)
- Storage RLS probe trigger
- Dead-letter persistence to `photo_upload_failures`

## 4. What's NOT changing

Per your "audit-only" instruction, no files are modified. If you want me to proceed with any of the P0/P1 items above, say which and I'll come back with a focused implementation plan.
