---
name: sync terminal error classification
description: Two-field severity model — syncError carries the message, syncErrorSeverity gates color/label. Pipeline failure = fatal red. Stats hiccup = soft amber. Quarantined records = own surface.
type: constraint
---
S42 (Fix F). The Sync Terminal must distinguish a real sync-pipeline failure from a non-fatal stats-read hiccup. Single-field `syncError` (truthy → red SYNC FAILED) lies — Fix C's soft "Stats refresh delayed…" message still got stamped red.

**Two-field model in `useAutoSync` state:**
- `syncError: string | null` — user-facing message.
- `syncErrorSeverity: 'fatal' | 'soft' | null` — drives color and badge label.

**Severity rules:**
- **Fatal** — actual sync-pipeline failure that blocks transmission. Today no path in `useAutoSync.performSync` writes a fatal `syncError`; pipeline catches toast via `toast-helpers` and let `lastSyncTime` carry the staleness signal. Reserve `'fatal'` for future pipeline-failure aggregation. PWA error boundary also sets `'fatal'` (init failure).
- **Soft** — counts-read hiccups that don't affect what already synced. Two sources, both default to soft:
  - `useAutoSync.doUpdateUnsyncedCounts` — `getUnsynced*` returned `IdbReadFailure`.
  - `useUnsyncedPhotos.idbReadError` — photo counts IDB failure.
- **Quarantined records** — neither. Surfaced separately as `QUARANTINED N` row with Retry Now button (see `mem://constraints/quarantine-vs-pending-count`).

**Consumer rule:** `SyncPulse` and `SyncStatusIndicator` derive their `error` phase from `syncError !== null && syncErrorSeverity === 'fatal'`. Soft errors keep the prior phase (synced/idle/unsynced) and render the message in **amber** (`text-amber-400 bg-amber-950/30`) prefixed with `NOTE:`. Fatal renders red (`text-red-400 bg-red-950/40`) prefixed with `ERR:`.

**Never** surface raw IDB error tokens (`idb_read_timeout`, `circuit_breaker_open`) — they read as catastrophic and aren't actionable.

**PWAProvider merge:** `syncErrorSeverity = autoSyncError ? (autoSyncErrorSeverity ?? 'soft') : photoIdbError ? 'soft' : null`. Never promote photo-only errors to fatal in the merge.
