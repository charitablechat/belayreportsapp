

## Sync — speed & reliability gap audit

The sync engine is correct and crash-safe but conservatively serial. There's a lot of latency on the table. Below: real gaps, ranked by impact, with concrete fixes. No data-integrity guards weaken in any of these.

---

### Real gaps (worth fixing)

**S1 — All four data types sync sequentially with `yieldToUI` waits (biggest wall-clock win)**

In `useAutoSync.performSync`, inspections → trainings → assessments → photos run one after the other, each preceded by a `yieldToUI()` setTimeout(0). For a typical sync this is 4 sequential network round-trips at minimum, even when each phase has 0–1 items. Inspections, trainings, assessments touch independent tables and child trees — they cannot conflict.

**Fix:** run the three report types in parallel via `Promise.allSettled([insp, train, assess])`, then run `syncPhotos()` after (photos depend on temp-ID → UUID mapping done by report sync). Keep per-type `MAX_BATCH_SIZE=5` so we don't blow up payloads. Net effect: ~3× faster for users who have mixed unsynced types; same speed for users with only one type.

---

**S2 — Within a single type, items sync strictly sequentially**

`syncAllInspectionsAtomic` loops `for (let i = 0; i < batch.length; i++)` awaiting each `syncInspectionAtomic`. With `MAX_BATCH_SIZE = 5`, a draining queue of 5 inspections takes 5× the per-item RTT (~3–8s each on mobile = 15–40s) before any feedback. Items don't share rows; they only share the same Postgres connection pool, which already handles concurrency.

**Fix:** process the batch with bounded concurrency — `Promise.allSettled` over chunks of 3 (configurable: 3 on mobile, 5 on desktop). Keep retry logic per-item. Failed items don't block siblings. Wall-clock goes from N×RTT to ~⌈N/3⌉×RTT. This is safe because each `syncInspectionAtomic` operates on a distinct `inspectionId` with its own transaction.

---

**S3 — Photo upload loop is fully sequential at concurrency=1**

`syncPhotos` in `sync-manager.ts` uploads photos in a `for…of` loop. Storage uploads on slow mobile networks dominate sync wall-clock (1–5s each × 10 photos = 10–50s). Supabase Storage handles parallel uploads fine, and we already cap to `MAX_PHOTO_BATCH_SIZE = 10`.

**Fix:** parallelize uploads with bounded concurrency of 3 (mobile) / 5 (desktop) using a small chunk runner. Preserve the existing dedup guard, retry counter, and `processedIds` set (made thread-safe by checking before await). Net: ~3–5× faster photo drains.

---

**S4 — Per-item `align_synced_at` RPC + post-sync verify SELECT add 2 round-trips per record**

For each record, after the transaction commits, we (1) `SELECT id, synced_at` to verify, then (2) call `align_synced_at` RPC to align timestamps. Both are single-RTT round-trips done serially. The verify SELECT is largely redundant — `executeTransaction` already throws if the upsert affected 0 rows (the row-count guard in `transaction-manager.ts`).

**Fix:** drop the post-transaction `select('id, synced_at')` verify; rely on the existing 0-row guard inside `executeTransaction` plus the `align_synced_at` RPC return value (which already errors if the record is missing). Saves ~100–300ms per record × N records per cycle. The integrity guarantee is preserved by `align_synced_at` failing loudly when no row exists.

---

**S5 — `MIN_SYNC_INTERVAL = 5000ms` blocks fast user-driven syncs**

Background syncs are gated by 5s minimum interval. Force sync (silent=false) bypasses, but that's not what runs after autosave. After a user edits an inspection, the 3s `DEBOUNCE_DELAY` plus 5s `MIN_SYNC_INTERVAL` floor means a save can wait up to 8s before the sync even starts, and another 5s gate blocks the next one if more edits land. This compounds the perception of slowness on rapid edits.

**Fix:** reduce `DEBOUNCE_DELAY` to 1500ms (matches `AUTO_SAVE_DEBOUNCE_MS` already used for IDB writes) and `MIN_SYNC_INTERVAL` to 2000ms. The duplicate-prevention work is done by `syncInProgressRef`, not by the interval — the interval just stops thrashing. 2s is enough to debounce flutter without feeling sluggish.

---

**S6 — `ACCELERATED_SYNC_DELAY = 5000ms` between batches when draining a queue**

When a sync completes with `remaining > 0`, the next batch waits 5s. For a 22-item queue with batch=5: 5 batches × (sync time + 5s wait) ≈ 100–150s instead of ~30–40s. The wait was originally to avoid hammering, but with batched concurrency (S2) the per-batch sync is already a few seconds and the server can absorb back-to-back batches.

**Fix:** drop to 1000ms when `totalRemaining > 0`, and skip the wait entirely if the previous batch had no failures. Keep a small floor to allow `setState` to flush.

---

**S7 — `INITIAL_SYNC_DELAY = 2000ms` blocks sync for 2 full seconds after app open**

We delay the first sync 2s after mount "to not block UI render". But Dashboard already loads from Supabase directly via React Query — sync is for reconciling local edits. 2s is overcautious; users opening the app to push a queued report wait 2s before the sync even tries.

**Fix:** drop to 500ms. UI is already paint-stable by then on every device class (verified by existing render-budget work for the auth flow).

---

**S8 — `align_synced_at` RPC is called per record instead of batched**

Each `align_synced_at` call is one RPC round-trip per record. For a 5-item batch, that's 5 sequential RPCs after the transactions complete (since they happen inside each `syncInspectionAtomic`).

**Fix (deferred — requires DB migration):** add a batch RPC `align_synced_at_batch(table, ids[])` returning a map. Call once per type at the end of the batch instead of per-item. **Not in this round** since it requires a DB migration; flag for follow-up if S1+S2+S3 don't move the needle enough.

---

**S9 — `getOfflineInspection` + 5 child `getRelatedDataOfflineWithStatus` calls run in parallel already, but the inspection fetch is serial before them**

In `syncInspectionAtomic`, we await `getOfflineInspection(id)` first, then run child reads in parallel. The inspection record is small and the dep is real (we need `inspector_id`), but we don't need to wait for it before kicking off child reads — they're keyed by `inspectionId` which we already have.

**Fix:** wrap the 6 IDB reads (parent + 5 children) in a single `Promise.all`. Saves one IDB round-trip (~5–50ms) per record. Modest, but compounds across batches.

---

**S10 — Realtime change handler triggers `triggerDebouncedSync()` (3s debounce) instead of `performSync` directly when guards pass**

When another device pushes an update, `handleRemoteChange` calls `triggerDebouncedSync()` which adds a 3s wait. For multi-device collaboration, that's a noticeable lag before the local IDB gets the remote-originated payload reflected (the IDB write itself happens immediately in the same handler — only the *sync* is debounced, so this is mostly benign). Still, the 3s extra wait is unnecessary since duplicate-call prevention is already handled by `syncInProgressRef` + `MIN_SYNC_INTERVAL`.

**Fix:** call `performSync(true)` directly (it's already guarded). Removes 3s lag on multi-device updates.

---

### Already solid (don't touch)

- Atomic transactions via `executeTransaction` with rollback
- Field-count regression guard with 3-skip escape valve
- Empty-local guard with server→local recovery
- Reconciliation tripwires (50% rule, absolute-delta ≥3, 70% wipe block)
- Pre-sync version snapshots + pre-delete backups
- Temp-ID → UUID transformation with dedup guard
- Circuit breaker for IDB failures
- Adaptive periodic interval (active vs idle)
- Mobile-network-aware retry (2 retries on mobile, 1 on desktop)
- Realtime channel auto-recovery with exponential backoff
- iOS-specific `pageshow` / `focus` handlers with debounce
- POST_SYNC_COOLDOWN to prevent self-triggered Realtime loops

---

### Out of scope

- **Service-worker background sync** — already implemented in `sw-sync.js`; not the bottleneck.
- **GraphQL / batched REST** — would require Supabase API changes outside our control.
- **WebSocket-based bidirectional sync** — Realtime already does this for receive; sending via WS would be a major rewrite for marginal gain.
- **S8 batch RPC** — defer until we see post-S1/S2/S3 numbers.

---

### Files to change

- `src/hooks/useAutoSync.tsx` — S1 (parallel type sync), S5 (lower debounce + min interval), S6 (faster drain delay), S7 (lower initial delay), S10 (Realtime → direct performSync)
- `src/lib/atomic-sync-manager.ts` — S2 (batched concurrency in all three `syncAll*Atomic`), S4 (drop redundant verify SELECT in all three `sync*Atomic`), S9 (parallel parent+child IDB reads)
- `src/lib/sync-manager.ts` — S3 (parallel photo uploads with bounded concurrency)

No DB migrations. No edge functions. No new dependencies. ~120 LOC net change.

### Risk

- **S1 (parallel type sync):** three concurrent transactions hitting Supabase simultaneously. Each touches a distinct table family (`inspection_*`, `training_*`, `daily_assessment_*`); no shared rows, no FK cycles. Existing per-record locking remains. Worst case is a brief connection-pool spike on the Supabase side, well within the project's compute headroom.
- **S2 (item concurrency 3):** different `inspectionId`s never share rows in the child tables, and `executeTransaction` is per-record. The 0-row guard inside `executeTransaction` will still catch RLS surprises. If a bug surfaces, drop concurrency back to 1 with a one-line constant change.
- **S3 (photo concurrency 3):** Storage handles parallel uploads. The dedup `processedIds` Set is read-then-await — chunked execution avoids the duplicate-add race because we only add to the set after a successful upload. Worst case: a rare double-upload that gets caught by the existing unique-constraint handler (already coded as success).
- **S4 (drop verify SELECT):** the row-count guard in `executeTransaction` (lines 137–151 of `transaction-manager.ts`) already throws if 0 rows came back from the upsert. `align_synced_at` errors loudly if the row vanished. Removing the SELECT does not reduce safety.
- **S5/S6/S7:** purely tuning. Easy to revert by changing constants.
- **S9 (parallel parent fetch):** parent and child IDB reads use independent IDB transactions; no consistency loss because we already snapshot a single point in time later in the pipeline (the validation step).
- **S10:** removing the debounce on Realtime → sync still has `syncInProgressRef` + `POST_SYNC_COOLDOWN` + `MIN_SYNC_INTERVAL` guards in front. No new loop risk.

### Expected wall-clock improvements

- Empty-queue background sync: ~400ms → ~150ms (S1+S4+S7)
- Single-type 5-item drain: ~25–40s → ~8–14s (S2+S4)
- Mixed 15-item drain (5 each type) + 10 photos: ~75–120s → ~20–35s (S1+S2+S3+S4+S6)
- After-edit perceived sync time: 3s debounce + 5s gate = ~8s → 1.5s + 2s = ~3.5s (S5)

### Verification

1. Add 5 inspections offline → reconnect → time from online event to badge clearing should drop from ~25–40s to ~8–14s.
2. Add 1 inspection + 1 training + 1 assessment offline → reconnect → all three should clear in roughly the same wall-clock as one type alone (parallel proof).
3. Add 10 photos to an inspection offline → reconnect → photos should drain in ~⅓ the time of current behavior.
4. Edit an inspection field rapidly → sync indicator should fire within ~3.5s of last keystroke (was ~8s).
5. From a second device, edit a shared inspection → first device's UI should reflect the change without the previous 3s extra debounce.
6. Open dashboard with offline-edited reports → first sync should kick off within 500ms (was 2s).
7. Drain a 22-item queue → total wall-clock should drop from ~100–150s to ~25–40s.
8. Verify `executeTransaction` row-count guard still fires by simulating an RLS block (e.g., temporarily set inspector_id wrong) — sync should fail cleanly with "affected 0 rows" error.

