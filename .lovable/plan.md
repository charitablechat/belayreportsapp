

## C3 — Use `max(T0.updated_at, serverTimestamp)` in the no-concurrent-edit path

### Finding

C1 already protects the "live IDB has a newer edit than T0" path (`atomic-sync-manager.ts:143-153`). The remaining gap is the **no-concurrent-edit** branch at line **155-160**:

```ts
await save({
  ...t0Snapshot,
  ...mergedFields,
  synced_at: serverTimestamp,
  updated_at: serverTimestamp,   // ← flattens to server clock
} as T);
```

When `t0Snapshot.updated_at > serverTimestamp` (device clock slightly ahead of server, or `serverTimestamp` is the begin-tx timestamp while T0's updated_at was stamped just before), we lose the higher local `updated_at`. With `synced_at == updated_at == serverTimestamp`, drift is zero and `getUnsyncedInspections` / `getUnsyncedTrainings` / `getUnsyncedDailyAssessments` (`offline-storage.ts:1266 / 2419 / 2760`, all using `isUpdatedAheadOfSync`) flag the record clean.

The fix is exactly what the audit proposes: `updated_at = max(T0.updated_at, serverTimestamp)`.

### Fix

Single-spot change in `safePostSyncSave` (`src/lib/atomic-sync-manager.ts:155-160`). Same write shape as today, just the max:

```ts
const t0UpdatedIso = (t0Snapshot as { updated_at?: string | null }).updated_at;
const t0Ms = t0UpdatedIso ? Date.parse(t0UpdatedIso) : NaN;
const serverMs = Date.parse(serverTimestamp);
const mergedUpdatedAt =
  Number.isFinite(t0Ms) && Number.isFinite(serverMs) && t0Ms > serverMs
    ? t0UpdatedIso!
    : serverTimestamp;

await save({
  ...t0Snapshot,
  ...mergedFields,
  synced_at: serverTimestamp,
  updated_at: mergedUpdatedAt,
} as T);

if (import.meta.env.DEV && mergedUpdatedAt !== serverTimestamp) {
  syncLog.log('[C3] T0.updated_at > serverTimestamp — preserved local timestamp', {
    id: recordId.substring(0, 8),
    t0: t0UpdatedIso,
    server: serverTimestamp,
  });
}
```

That's it. The C1 concurrent-edit branch (lines 143-153) already does the right thing for the live-newer case and needs no change.

### Why this is safe

- When `serverTimestamp >= T0.updated_at` (the common case): `mergedUpdatedAt === serverTimestamp`, so `synced_at == updated_at`, drift = 0, record is correctly clean. Identical to today's behavior.
- When `T0.updated_at > serverTimestamp` (device-ahead-of-server case): `updated_at` keeps the higher value, `synced_at` is the server stamp. Drift is positive but bounded by the clock skew, and `SYNC_DRIFT_TOLERANCE_MS` (30 s) absorbs ordinary skew so the record still reads clean for any reasonable skew. Only an outright clock-skew anomaly bigger than 30 s would cause an extra sync cycle — which is the *correct* outcome (better one harmless redundant upload than a silent edit loss).
- No interaction with C1: that path returns early (line 152) before reaching this branch.
- No interaction with the empty-guard recovery path (C2): it doesn't go through `safePostSyncSave`.

### Out of scope

- Changing `SYNC_DRIFT_TOLERANCE_MS`.
- The C1 concurrent-edit branch (already correct).
- Child-row writes — they don't go through `safePostSyncSave`.

### Risk

Trivial. Single helper, single arithmetic change, fall-through identical to today when timestamps parse cleanly to `serverTimestamp >= T0`.

### Verification

- `npx tsc --noEmit`.
- DEV: temporarily set device clock 60 s ahead, save an inspection, trigger sync. Confirm:
  - Console: `[C3] T0.updated_at > serverTimestamp — preserved local timestamp`.
  - The record's IDB `updated_at` is the local (higher) timestamp; `synced_at` is the server timestamp.
  - Next `getUnsyncedInspections` cycle reads ~60 s drift, which is *above* the 30 s tolerance — so the record syncs once more (acceptable; one extra harmless upload). After that round-trip, `synced_at` aligns and it stays clean.
- DEV with normal clock: confirm no `[C3]` line and existing single-cycle "clean after sync" behavior is unchanged.
- Repeat for trainings and daily assessments (same helper covers all three).

