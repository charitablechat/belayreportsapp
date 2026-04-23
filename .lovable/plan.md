

## S14 — Eliminate the 5s drift trap on slow networks

**Root cause.** `SYNC_DRIFT_TOLERANCE_MS = 5000` is queried from three places — `isLocalDataNewer`, `shouldPreserveLocalRecord`, and the unsynced-counts query in `offline-storage.ts`. On slow mobile networks, the gap between local `updated_at = clientNow()` and server-side `synced_at = serverNow()` (which is set when the round-trip finally lands) routinely exceeds 5s. The record then re-flags as dirty, the badge ticks back to "1 pending," and the next auto-sync cycle re-uploads identical data — the classic "sync keeps showing 1 pending" symptom.

The plan addresses both layers: **(a)** raise the tolerance for the immediate symptom, **(b)** also remove the drift entirely by writing the server-authoritative `updated_at` back to local on successful sync.

---

### Two-part fix

**Part A — Raise tolerance to 30s.**

`SYNC_DRIFT_TOLERANCE_MS` becomes `30_000`. Single edit, propagates to all three callers via the shared constant. 30s comfortably covers slow-3G round-trips, push-notification-deferred wakes, and Postgres-trigger jitter. Real user edits virtually always produce drift in the minute-plus range, so masking risk is negligible.

Update the JSDoc on the constant to record why the number changed (slow-mobile timing window).

**Part B — Anchor local timestamps to server reality on successful sync.**

After every successful parent write in `atomic-sync-manager.ts`, the upsert response carries the server's authoritative `updated_at`. Today the code sets `synced_at = new Date().toISOString()` (client clock) but leaves `updated_at` at whatever the client originally wrote — that's the gap.

Three sync entry points to update — `syncAllInspectionsAtomic`, `syncAllTrainingsAtomic`, `syncAllDailyAssessmentsAtomic`. Each one already does an upsert and reads back the row; we just need to thread `data.updated_at` and `data.synced_at` from the server response into the local IDB write:

```ts
// after successful upsert returning .select().single()
const serverUpdatedAt = data?.updated_at ?? new Date().toISOString();
const serverSyncedAt  = data?.synced_at  ?? serverUpdatedAt;

await saveInspectionOffline({
  ...localRecord,
  ...data,                         // server fields take precedence
  updated_at: serverUpdatedAt,     // <- key change: anchor to server clock
  synced_at:  serverSyncedAt,      // <- and use server sync stamp if present
});
```

Combined with the bumped tolerance, drift becomes ~0 immediately after sync (server values are equal-or-equal-within-trigger-jitter), and the 30s window absorbs anything that does slip through on the next observation.

**Edge case — child rows.** Children (`inspection_systems`, `inspection_ziplines`, etc.) don't carry their own `synced_at`, only the parent does. The child reconciliation loop already overwrites local children with server children on successful sync, so no change needed there.

**Edge case — clear-intent marker (S9).** `user_cleared_at` reset already fires after successful sync; verify the new `updated_at` write doesn't accidentally restore it (it shouldn't — the reset happens in the same write).

---

### Files

- `src/lib/local-data-guards.ts` — bump `SYNC_DRIFT_TOLERANCE_MS` to `30_000`, update the doc comment to mention slow-mobile timing.
- `src/lib/atomic-sync-manager.ts` — at the three "successful parent upsert" sites, read `updated_at` / `synced_at` from the upsert response and pass them verbatim into the local IDB write that follows. Search anchor: existing `synced_at: new Date().toISOString()` literals next to the `.upsert(...).select().single()` calls.

### Out of scope

- Surfacing a per-record "sync diagnostic" overlay (separate UI work).
- Eliminating client-side `updated_at` entirely in favor of server-only stamping (would require RLS policy changes — too broad for this fix).
- Replacing the polling unsynced-counts query with a Postgres-channel listener (different problem; addressed in earlier S-items).

### Risk

Very low. Part A is a single number change behind an existing shared constant — every caller already imports it. Part B is additive: if the server response lacks `updated_at` (shouldn't happen post-Postgres trigger but defensively coded), we fall back to the existing `new Date().toISOString()` behavior, i.e. no regression. No schema, no UI, no migration.

