import { openDB, DBSchema, IDBPDatabase, StoreNames } from 'idb';
import { isIdbClosingError } from './idb-closing-error';
import { checkStorageQuota, requestPersistentStorage, isMobile } from './mobile-detection';
import { isUpdatedAheadOfSync } from './local-data-guards';
import { safeSetItem } from './safe-local-storage';
// Imported statically (rather than `await import('./idb-migration-safety')`
// inside getDB) so the 5s IDB-open budget cannot be consumed by a network
// fetch when the lazy chunk has no SW precache entry. When offline, that
// fetch hangs/fails, which manifested as four consecutive
// `[Offline Storage] IndexedDB open timed out after 5s` warnings and a
// degraded offline-save path. The module is ~6KB; bundling it costs
// nothing on the critical IDB hot path. Confirmed no circular dependency:
// `idb-migration-safety.ts` only imports from `idb`, never back from
// `offline-storage.ts`.
import * as migrationSafety from './idb-migration-safety';
// Audit P3: static-import addSyncNotification so the relink-orphan warning
// path cannot fail silently if the dynamic chunk fetch hangs on a flaky-Wi-Fi
// iPad. Mirrors the static-import hardening pattern from PR #18
// (idb-migration-safety). `notification-center` has zero imports of its
// own — no circular-dependency risk. Module is ~3 KB; trivial bundle cost.
import { addSyncNotification as addSyncNotificationStatic } from './notification-center';
// Audit H1: static-import sync-quarantine for the same reason as P3 above.
// The three getUnsynced* functions used to `await import('./sync-quarantine')`
// on the autosync hot path. atomic-sync-manager.ts already statically imports
// the same module (lines 22-37 there) precisely to avoid `TypeError: Failed
// to fetch dynamically imported module` on flaky-network iPads, but the
// fix collapsed if Vite ever code-split the chunk differently. Pinning the
// static import here removes the latent regression cliff. `sync-quarantine`
// only imports `sync-logger` — no circular-dependency risk. Module is ~5 KB.
import { isQuarantined as isSessionQuarantined, jitteredPhotoBackoffMs } from './sync-quarantine';
import { syncLog } from './sync-logger';

/** Opaque DB row — fields vary across tables and are read/written structurally.
 *  Uses an `any` index signature so callers can structurally read/write
 *  table-specific columns without per-site casts. Known columns are kept
 *  as required `string` for the few that the sync pipeline always relies on. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbRow = { [key: string]: any } & {
  id?: string;
  inspector_id?: string;
  updated_at?: string;
  synced_at?: string;
  created_at?: string;
  organization?: string;
  organization_id?: string;
  inspection_id?: string;
  user_id?: string;
  status?: string;
};

interface InspectionDB extends DBSchema {
  inspections: {
    key: string;
    value: DbRow;
    indexes: { 'by-status': string; 'by-synced': string };
  };
  daily_assessments: {
    key: string;
    value: DbRow;
    indexes: { 'by-status': string; 'by-synced': string };
  };
  operations: {
    key: number;
    value: {
      id?: number;
      type: 'create' | 'update' | 'delete';
      inspectionId: string;
      data: Record<string, unknown>;
      timestamp: number;
      retries: number;
    };
  };
  assessment_operations: {
    key: number;
    value: {
      id?: number;
      type: 'create' | 'update' | 'delete';
      assessmentId: string;
      data: Record<string, unknown>;
      timestamp: number;
      retries: number;
    };
  };
  photos: {
    key: string;
    value: {
      id: string;
      inspectionId: string;
      section: string;
      blob: Blob | null; // Nullified after successful upload to free storage
      fileName: string;
      timestamp: number;
      // IDB cannot index booleans — must be 0 | 1 for the by-uploaded index.
      uploaded: 0 | 1;
      photoUrl?: string;
      cachedAt?: number; // Timestamp when photo was cached from remote
      uploadedAt?: number; // M6: Timestamp when photo's upload to server was confirmed
      lastValidated?: number; // Last time cache was validated
      display_order?: number; // Order for drag-and-drop reordering
      tableName?: string; // DB table for sync (e.g. 'training_photos')
      storageBucket?: string; // Storage bucket (e.g. 'training-photos')
      foreignKeyColumn?: string; // FK column (e.g. 'training_id')
      caption?: string; // Photo caption for gallery labeling
      retryCount?: number; // Failed upload retry counter
      lastError?: string | null; // S22: Human-readable last upload error
      lastErrorAt?: number | null; // S22: epoch ms when lastError was stamped
      // L5: Earliest epoch ms the photo is eligible to retry. Stamped (with
      // jittered backoff baked in) on every transient or permanent failure;
      // cleared by markPhotoAsUploaded / resetPhotoForRetry. When non-null
      // and > Date.now(), getUnuploadedPhotos skips the photo so a herd of
      // co-failed photos doesn't pound the network in the next cycle.
      nextRetryAt?: number | null;
      // P1 (audit Mode-13B): Number of consecutive *transient* failures (network /
      // 5xx / abort) for this photo. Independent of `retryCount` (which only counts
      // permanent failures). Used by `syncPhotos` to demote a photo to dead-letter
      // after `MAX_TRANSIENT_PHOTO_ATTEMPTS` so a photo can't loop forever in the
      // RETRYING bucket on a persistent classify-as-transient failure mode.
      // Cleared on success / manual retry. Optional for back-compat with v15- rows.
      transientCount?: number;
      capturedByUserId?: string | null; // S23: User-id active when this photo was staged
      // Rescue Sweep v1: timestamp set by runPhotoRescueSweep() when a previously
      // dead-lettered or long-stuck photo has been re-queued one time under the
      // post-fix sync logic. Presence makes the sweep idempotent per-photo and
      // gives support a way to audit which photos were touched.
      rescuedAt?: number;
    };
    indexes: { 'by-inspection': string; 'by-uploaded': number };
  };
  inspection_systems: {
    key: string;
    value: DbRow;
    indexes: { 'by-inspection': string };
  };
  inspection_ziplines: {
    key: string;
    value: DbRow;
    indexes: { 'by-inspection': string };
  };
  inspection_equipment: {
    key: string;
    value: DbRow;
    indexes: { 'by-inspection': string };
  };
  inspection_standards: {
    key: string;
    value: DbRow;
    indexes: { 'by-inspection': string };
  };
  inspection_summary: {
    key: string;
    value: DbRow;
    indexes: { 'by-inspection': string };
  };
  daily_assessment_beginning_of_day: {
    key: string;
    value: DbRow;
    indexes: { 'by-assessment': string };
  };
  daily_assessment_end_of_day: {
    key: string;
    value: DbRow;
    indexes: { 'by-assessment': string };
  };
  daily_assessment_operating_systems: {
    key: string;
    value: DbRow;
    indexes: { 'by-assessment': string };
  };
  daily_assessment_equipment_checks: {
    key: string;
    value: DbRow;
    indexes: { 'by-assessment': string };
  };
  daily_assessment_structure_checks: {
    key: string;
    value: DbRow;
    indexes: { 'by-assessment': string };
  };
  daily_assessment_environment_checks: {
    key: string;
    value: DbRow;
    indexes: { 'by-assessment': string };
  };
  trainings: {
    key: string;
    value: DbRow;
    indexes: { 'by-status': string; 'by-synced': string };
  };
  training_operations: {
    key: number;
    value: {
      id?: number;
      type: 'create' | 'update' | 'delete';
      trainingId: string;
      data: Record<string, unknown>;
      timestamp: number;
      retries: number;
    };
  };
  training_delivery_approaches: {
    key: string;
    value: DbRow;
    indexes: { 'by-training': string };
  };
  training_operating_systems: {
    key: string;
    value: DbRow;
    indexes: { 'by-training': string };
  };
  training_immediate_attention: {
    key: string;
    value: DbRow;
    indexes: { 'by-training': string };
  };
  training_verifiable_items: {
    key: string;
    value: DbRow;
    indexes: { 'by-training': string };
  };
  training_systems_in_place: {
    key: string;
    value: DbRow;
    indexes: { 'by-training': string };
  };
  training_summary: {
    key: string;
    value: DbRow;
    indexes: { 'by-training': string };
  };
  report_backups: {
    key: string;
    value: {
      id: string;
      reportType: string;
      reportId: string;
      reportKey: string;
      timestamp: number;
      data: Record<string, unknown>;
    };
    indexes: { 'by-report': string; 'by-timestamp': number };
  };
  report_versions: {
    key: string;
    value: {
      id: string;
      reportType: string;
      reportId: string;
      versionNumber: number;
      timestamp: number;
      device: string;
      parentData: Record<string, unknown>;
      childrenData: Record<string, Record<string, unknown>[]>;
      trigger: string;
      fieldCount: number;
    };
    indexes: { 'by-report': string; 'by-timestamp': number; 'by-report-version': [string, number] };
  };
  autocomplete_history: {
    key: string; // compound: `${field_type}::${value}`
    value: {
      id: string;
      field_type: string;
      value: string;
      usage_count: number;
      last_used_at: string;
      synced: boolean;
    };
    indexes: { 'by-field-type': string; 'by-synced': number };
  };
  equipment_type_cache: {
    key: string; // compound: `${category}::${label}`
    value: {
      id: string;
      equipment_category: string;
      label: string;
      display_order: number;
      is_active: boolean;
      synced: boolean;
    };
    indexes: { 'by-category': string };
  };
  /**
   * 1.C — Persistent dead-letter store for photos that crossed the upload
   * retry threshold. Keyed by photo id. Surfaced in SyncDiagnosticsSheet
   * (and consumable by an admin panel) so failures are never silent orphans.
   */
  photo_upload_failures: {
    key: string;
    value: {
      id: string;            // photo id (matches `photos` keyPath)
      inspectionId: string;
      fileName: string;
      photoUrl?: string;
      section?: string;
      retryCount: number;
      lastError: string;
      lastErrorAt: number;
      firstFailedAt: number;
      capturedByUserId?: string | null;
    };
    indexes: { 'by-failed-at': number };
  };
  /** v11: field-count regression skip counters (S10). */
  sync_regression_counters: {
    key: string;
    value: DbRow;
  };
  /** v12: dead-letter queue for exhausted soft-delete queue ops (S28). */
  dead_letter_soft_deletes: {
    key: string;
    value: DbRow;
  };
  /** v13: empty-local conflict holds (C2). */
  sync_empty_local_conflicts: {
    key: string;
    value: DbRow;
  };
  /** v14: queued admin pre-edit snapshots captured while offline (H10). */
  admin_edit_snapshot_queue: {
    key: number;
    value: DbRow;
    indexes: { 'by-report': [string, string] };
  };
}

let dbPromise: Promise<IDBPDatabase<InspectionDB>> | null = null;
let storageWarningShown = false;

// Mode 6 fix: track the most recent `online` event so the IDB-open race and
// boundary OPERATION_TIMEOUT can widen their budgets while the storage layer
// is still recovering from a `setOffline(true→false)` toggle (or a real
// cell-tower handoff returning to coverage). The first `openDB(DB_NAME, 18)`
// after such a toggle has been observed to take >5s on Playwright/Chromium
// CI runners (see `mode-6-idb-wedge-after-offline-toggle.md`), which exceeds
// the steady-state 5s/8s budget and triggers a 2-minute cascade where every
// boundary read short-circuits to `IdbReadFailure`. Stamping the timestamp
// here lets `selectIdbOpenTimeout(..., postOnlineRecovery=true)` and the
// three `withIndexedDB*Boundary` helpers temporarily switch to the wider
// upgrade-grade budget.
let lastOnlineRecoveryAt = 0;
// Mode 7A — calibration update from PR #104's CI evidence. Mode 6 set this to
// 30s based on PR #102 logs (~2min wedge tail). PR #104's run showed the wedge
// can drag out for 4-5min, so the 30s ceiling let the grace expire while the
// storage layer was still recovering — every boundary fell back to the
// steady-state 5s budget for the remaining ~3min. 90s covers the observed P95
// recovery curve without widening the H5 hung-IDB protection beyond its
// design point (a *real* hung DB now has 90s of spinner before the user gets
// the "we can't read your data" signal — acceptable trade vs the
// silent-data-loss risk Mode 6 was protecting against).
export const POST_ONLINE_RECOVERY_GRACE_MS = 90_000; // 90s post-`online` grace

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    lastOnlineRecoveryAt = Date.now();
    // Mode 9A — synchronous `dbPromise` close + reset, gated on positive
    // wedge evidence. Symmetric with the existing `cached-auth.ts`
    // bfcache `pageshow` handler (`softInvalidateForBfcacheRestore`).
    // Important caveat: per the W3C IndexedDB spec there is no way to
    // abort an in-flight `IDBOpenDBRequest`, so closing/nulling the
    // promise here doesn't cancel any wedged open already in the
    // browser's request queue — it only ensures the FOLLOWING `getDB()`
    // call (8B's warm-up below) starts a brand-new request rather than
    // awaiting the wedged one. Composed with Mode 8A this is a slight
    // recovery-curve win without adding net queue depth: the breaker
    // bounds the rate at which new opens are queued. We ALSO gate via
    // `shouldResetDbOnOnline` to avoid close-churn for users
    // reconnecting from a healthy network handoff (see
    // `mode-9-structural-force-drain-diagnostic.md` for the full
    // rationale + risk model).
    if (shouldResetDbOnOnline()) {
      const stale = dbPromise;
      dbPromise = null;
      if (stale) {
        stale.then(db => db.close()).catch(() => { /* ignore */ });
      }
    }
    // Mode 8B — pre-warm getDB() so the slow first open after
    // setOffline(true→false) (or a real cell-tower handoff returning to
    // coverage) happens ONCE instead of cascading through 200+ boundary
    // cycles. Each subsequent call awaits the same in-flight `dbPromise`,
    // so this fire-and-forget call lets the upgrade-grade open race start
    // immediately on the `online` event rather than after the first user
    // action / autosync drain. Failure is invisible — the boundary helpers
    // catch it via their own timeout/error paths (see
    // `mode-8-structural-idb-wedge-diagnostic.md`).
    try {
      getDB().catch(() => { /* boundary will catch */ });
    } catch { /* getDB itself can throw synchronously when storage is unavailable */ }
  });
}

/**
 * @returns true if a network `online` event fired within the last
 * `POST_ONLINE_RECOVERY_GRACE_MS`. Exported so the contract can be
 * unit-tested without spinning up real IDB or DOM events; tests use
 * `setLastOnlineRecoveryAtForTests` to stamp the timestamp directly.
 */
export function isInPostOnlineRecoveryGrace(now: number = Date.now()): boolean {
  if (lastOnlineRecoveryAt === 0) return false;
  return now - lastOnlineRecoveryAt < POST_ONLINE_RECOVERY_GRACE_MS;
}

/** Test-only setter — production code uses the `online` event listener above. */
export function setLastOnlineRecoveryAtForTests(ts: number): void {
  lastOnlineRecoveryAt = ts;
}

// Health check cache with 30-second TTL
let healthCheckCache: { isHealthy: boolean; timestamp: number } | null = null;
const HEALTH_CHECK_TTL = 30000; // 30 seconds

// ============= CIRCUIT BREAKER PATTERN =============
// M5: Breaker state is now PER-STORE instead of one global counter. Previously
// a single timeout in `getAllPhotos` would trip the global breaker and block
// all subsequent `getOfflineInspection` calls for the cooldown window — even
// though the inspections store may have been perfectly healthy. Each logical
// store (`inspections`, `trainings`, `daily_assessments`, `photos`, plus a
// `'global'` bucket for legacy untagged callers) now owns its own failure
// counter and trip timestamp. The async probe and the public status helpers
// still aggregate across all stores so the existing UI keeps working.
const CIRCUIT_BREAKER_THRESHOLD = 3;
const BASE_CIRCUIT_BREAKER_RESET_TIME = 60000; // 1 minute base cooldown
const MAX_CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minute max cooldown

export type BreakerStoreKey =
  | 'inspections'
  | 'trainings'
  | 'daily_assessments'
  | 'photos'
  | 'global';

interface BreakerState {
  failureCount: number;
  trippedAt: number | null;
  resetCount: number; // Tracks consecutive trips for exponential backoff
}

function newBreakerState(): BreakerState {
  return { failureCount: 0, trippedAt: null, resetCount: 0 };
}

const breakerStates = new Map<BreakerStoreKey, BreakerState>();
let circuitBreakerProbing = false; // Prevents concurrent probe attempts (global)

// ============= MODE 8A: LAYER-LEVEL QUEUE-STUCK BREAKER =============
// The per-store breaker above is keyed by `BreakerStoreKey` and trips after
// 3 failures within a single bucket. In practice ~60 of ~70 boundary call
// sites in this file default to 'global' — so the per-store breaker dilutes:
// the dominant 'global' bucket trips fast and protects most callers, but
// the autosync drain on 'inspections'/'trainings'/'daily_assessments' (each
// in its own bucket) still piles new opens onto an already-wedged browser
// IDBOpenDBRequest queue while waiting for its own bucket to hit threshold.
//
// Mode 8A adds a layer-level counter that increments on EVERY boundary
// timeout (any store) and trips a global "idb-queue-stuck" fast-fail window
// once `LAYER_BREAKER_THRESHOLD` consecutive timeouts are observed. While
// this layer breaker is open, all three boundary helpers fast-fail at the
// top of the function — no new `getDB()` is called, no new `openDB` is
// queued, the wedged queue gets a chance to drain naturally before more
// callers pile on. See `mode-8-structural-idb-wedge-diagnostic.md` for
// the full rationale.
let layerBreakerConsecutiveTimeouts = 0;
let layerBreakerTrippedAt: number | null = null;
let layerBreakerResetCount = 0; // For exponential cooldown backoff (mirrors per-store breaker).
const LAYER_BREAKER_THRESHOLD = 3;
const LAYER_BREAKER_BASE_COOLDOWN_MS = 60_000; // 1 minute base
const LAYER_BREAKER_MAX_COOLDOWN_MS = 240_000; // 4 minute ceiling

// Audit M1 — Hard cap on the working-set scan size for `getUnsynced*`
// readers. The current implementation does `db.getAll('inspections')`
// (and equivalents for `trainings` / `daily_assessments`), which deserialises
// the entire store into JS heap before filtering. For typical users the
// store holds <100 records and this is fast, but a broken sync engine, a
// runaway form-write loop, or a migration-from-cloud hydration that
// over-shoots its budget can bloat the store into the thousands. When that
// happens, the full scan blocks the IDB transaction long enough to tip the
// layer breaker, which masks the underlying bloat with a noisier error
// (queue-stuck) and starves drain of any chance to recover.
//
// The cap is enforced via `getAll(query, count)` (idb's third positional)
// which limits the cursor walk at the IDB layer — the engine does not
// even materialise records past the cap into JS. We then issue a cheap
// `db.count(store)` to see how badly we're over the cap; if so, we emit
// a single Sentry warning per session per store so we can re-architect
// later without spamming. The truncated working set is still processed
// normally — partial drain is strictly better than no drain.
const UNSYNCED_SCAN_CAP = 10_000;
const overflowReportedStores = new Set<string>();

async function reportUnsyncedScanOverflow(
  store: string,
  cap: number,
  realTotal: number,
  callerName: string,
): Promise<void> {
  if (overflowReportedStores.has(store)) return;
  overflowReportedStores.add(store);

  console.warn('[Offline Storage] Unsynced scan exceeded cap — store is unexpectedly bloated', {
    store,
    cap,
    realTotal,
    overflow: realTotal - cap,
    caller: callerName,
  });

  try {
    const { logError } = await import('./log-error');
    try {
      logError(new Error(`Unsynced scan cap exceeded for ${store}`), {
        scope: 'unsynced-scan-overflow',
        extra: {
          store,
          cap,
          realTotal,
          overflow: realTotal - cap,
          caller: callerName,
        },
      });
    } catch {
      /* swallow */
    }
  } catch {
    /* swallow — log-error import failed; nothing actionable */
  }
}

/**
 * Audit M1 — observability hook for callers that just executed a capped
 * `getAll(store, undefined, UNSYNCED_SCAN_CAP)`. If the result exactly
 * equals the cap (the only signal that the cap was hit), we issue a cheap
 * `db.count(store)` to see how far over we are, and emit a single
 * Sentry warning per session per store. The truncated working set is
 * still processed normally — partial drain is strictly better than no drain.
 */
async function maybeReportUnsyncedScanOverflow(
  db: { count: (store: never) => Promise<number> },
  store: string,
  rowsLength: number,
  callerName: string,
  cap: number = UNSYNCED_SCAN_CAP,
): Promise<void> {
  if (rowsLength < cap) return;
  try {
    const realTotal = await db.count(store as never);
    if (realTotal > cap) {
      void reportUnsyncedScanOverflow(store, cap, realTotal, callerName);
    }
  } catch {
    // count() fail is non-fatal; we still have rows from the capped getAll.
  }
}

/** @internal Test-only — clear the per-session overflow-reported set. */
export function __test_only__resetUnsyncedScanOverflowState(): void {
  overflowReportedStores.clear();
}

// Mode 9F — autosync-resume hook. The breaker auto-clears on cooldown-expiry
// (see `isIdbLayerBreakerOpen` below). When that happens, we want any
// observers (e.g. `useAutoSync`) to immediately attempt a drain rather than
// waiting up to 30s for the next `setInterval` tick. Each cooldown cycle
// represents a probe opportunity against a (hopefully) drained IDB queue;
// missing the opportunity by 0-30s is the difference between the
// `offline-edit-reconcile` spec passing within its 120s budget and timing
// out. Subscribers are fire-and-forget: their throws are caught locally so
// one bad subscriber cannot poison the cleanup transition.
const layerBreakerCloseSubscribers: Set<() => void> = new Set();

function emitLayerBreakerClosed(): void {
  if (layerBreakerCloseSubscribers.size === 0) return;
  // Snapshot first so subscribers that synchronously unsubscribe do not
  // mutate the set mid-iteration.
  const snapshot = Array.from(layerBreakerCloseSubscribers);
  for (const cb of snapshot) {
    try {
      cb();
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[Offline Storage] Layer breaker close subscriber threw:', err);
      }
    }
  }
}

/**
 * Subscribe to the layer breaker's open→closed cooldown-expiry transition.
 * The callback fires once per transition (not on success-recovery — the
 * breaker can only close via cooldown expiry while it is tripped, since
 * boundary helpers fast-fail and never reach `recordLayerBoundarySuccess`
 * during the open window).
 *
 * @returns Unsubscribe function. Idempotent — safe to call multiple times.
 */
export function subscribeToLayerBreakerClose(cb: () => void): () => void {
  layerBreakerCloseSubscribers.add(cb);
  return () => {
    layerBreakerCloseSubscribers.delete(cb);
  };
}

// Mode 9A — last successful or failed boundary-call timestamp. Used by the
// `online` event listener to gate the synchronous `dbPromise` reset: only
// fire the reset when there has been recent IDB activity (suggesting a real
// wedge candidate, not a fresh page load that happens to fire `online`
// during initial reconciliation). Healthy reconnects on a steady-state app
// don't increment this and therefore don't trigger close-churn.
let lastDbActivityAt = 0;

function getLayerBreakerCooldownMs(): number {
  return Math.min(
    LAYER_BREAKER_BASE_COOLDOWN_MS * Math.pow(2, layerBreakerResetCount),
    LAYER_BREAKER_MAX_COOLDOWN_MS,
  );
}

/**
 * @returns true if the layer-level queue-stuck breaker is currently open
 * (within its cooldown window after `LAYER_BREAKER_THRESHOLD` consecutive
 * boundary timeouts). When the cooldown has expired, this also performs
 * the cleanup transition (clears `trippedAt`, escalates `resetCount` for
 * the next trip's backoff, and resets the consecutive counter so the next
 * boundary call gets a fresh attempt against the underlying queue).
 *
 * Exported for use in tests and (potentially) telemetry.
 */
export function isIdbLayerBreakerOpen(now: number = Date.now()): boolean {
  if (layerBreakerTrippedAt === null) return false;
  if (now - layerBreakerTrippedAt > getLayerBreakerCooldownMs()) {
    // Cooldown expired — clear, escalate the reset count so the next trip
    // backs off further, and let the next boundary call probe naturally.
    layerBreakerTrippedAt = null;
    layerBreakerConsecutiveTimeouts = 0;
    layerBreakerResetCount++;
    // Mode 9F — notify subscribers so e.g. `useAutoSync` can `performSync`
    // immediately instead of waiting for the next 30s interval tick.
    emitLayerBreakerClosed();
    return false;
  }
  return true;
}

function recordLayerBoundaryTimeout(): void {
  // Mode 9A — stamp activity timestamp so the `online` listener's gating
  // logic can distinguish "recent wedge" from "fresh page load".
  lastDbActivityAt = Date.now();
  layerBreakerConsecutiveTimeouts++;
  if (
    layerBreakerConsecutiveTimeouts >= LAYER_BREAKER_THRESHOLD &&
    layerBreakerTrippedAt === null
  ) {
    layerBreakerTrippedAt = Date.now();
    const cooldownSec = getLayerBreakerCooldownMs() / 1000;
    console.warn(
      `[Offline Storage] IDB layer breaker tripped — ${LAYER_BREAKER_THRESHOLD} consecutive boundary timeouts; fast-failing for ${cooldownSec}s (backoff #${layerBreakerResetCount})`,
    );
    // One-shot diagnostic: snapshot storage estimate the first time the
    // breaker opens per session. Helps confirm whether affected devices are
    // quota-bound. `_diagLogged` ensures we don't spam on subsequent trips.
    if (!layerBreakerDiagLogged) {
      layerBreakerDiagLogged = true;
      void (async () => {
        try {
          const est = (typeof navigator !== 'undefined' && navigator.storage?.estimate)
            ? await navigator.storage.estimate()
            : null;
          console.warn('[Offline Storage] IDB breaker diagnostics', {
            consecutiveTimeouts: layerBreakerConsecutiveTimeouts,
            resetCount: layerBreakerResetCount,
            storageEstimate: est
              ? { usage: est.usage, quota: est.quota, pct: est.quota ? ((est.usage ?? 0) / est.quota * 100).toFixed(1) + '%' : 'n/a' }
              : 'unavailable',
          });
        } catch {
          /* diagnostics-only; never throw */
        }
      })();
    }
  }
}

let layerBreakerDiagLogged = false;

function recordLayerBoundarySuccess(): void {
  // Mode 9A — stamp activity timestamp so the `online` listener's gating
  // logic can distinguish "recent activity" from "fresh page load".
  lastDbActivityAt = Date.now();
  if (
    layerBreakerConsecutiveTimeouts > 0 ||
    layerBreakerTrippedAt !== null ||
    layerBreakerResetCount > 0
  ) {
    layerBreakerConsecutiveTimeouts = 0;
    layerBreakerTrippedAt = null;
    layerBreakerResetCount = 0;
  }
}

/**
 * Mode 9A — gating predicate for the `online` event's synchronous
 * `dbPromise` close + reset. Returns true ONLY when we have positive
 * evidence the IDB queue may be wedged: recent boundary activity AND
 * either the layer breaker is currently tripped or at least one
 * boundary timeout has accumulated since the last success. Field
 * workers reconnecting from a healthy network handoff (no recent
 * boundary activity, or successful steady-state reads) skip the reset.
 *
 * Exported so the gating contract can be unit-tested without spinning
 * up real IDB or DOM events.
 */
export function shouldResetDbOnOnline(
  now: number = Date.now(),
  options?: { recentActivityWindowMs?: number },
): boolean {
  // No activity ever — fresh page load that happened to fire `online`. Skip.
  if (lastDbActivityAt === 0) return false;
  const window = options?.recentActivityWindowMs ?? 5_000;
  if (now - lastDbActivityAt > window) return false;
  // Recent activity present. Reset only when there's positive wedge
  // evidence: breaker is open OR at least one timeout has been recorded.
  return isIdbLayerBreakerOpen(now) || layerBreakerConsecutiveTimeouts >= 1;
}

/** Test-only state setter — production code uses the boundary helpers' record* paths. */
export function __test_only__setLayerBreakerStateForTests(state: {
  consecutiveTimeouts?: number;
  trippedAt?: number | null;
  resetCount?: number;
  lastDbActivityAt?: number;
}): void {
  if (state.consecutiveTimeouts !== undefined) layerBreakerConsecutiveTimeouts = state.consecutiveTimeouts;
  if (state.trippedAt !== undefined) layerBreakerTrippedAt = state.trippedAt;
  if (state.resetCount !== undefined) layerBreakerResetCount = state.resetCount;
  if (state.lastDbActivityAt !== undefined) lastDbActivityAt = state.lastDbActivityAt;
}

/** Test-only reset — returns the state to fresh-module defaults. */
export function __test_only__resetLayerBreakerForTests(): void {
  layerBreakerConsecutiveTimeouts = 0;
  layerBreakerTrippedAt = null;
  layerBreakerResetCount = 0;
  lastDbActivityAt = 0;
  layerBreakerCloseSubscribers.clear();
}

/**
 * Sprint 2 H — production-callable reset for the layer-level queue-stuck
 * breaker, intended for direct evidence-of-life from the user (opening
 * SyncPulse, tapping Retry, etc.). The layer breaker exists to protect a
 * wedged IDB queue from cascading new openDB calls during the wedge
 * window; if the user is actively interacting with the page, the OS-level
 * IDB wedge has clearly resolved (otherwise the page itself would be
 * unresponsive), so making them wait out the 1-4 minute cooldown is pure
 * latency cost.
 *
 * Differs from `resetCircuitBreaker` (per-store breakers) because:
 *  - the per-store breakers in `breakerStates` reflect store-specific
 *    failure rates, while the layer breaker reflects a structural IDB
 *    wedge across all stores;
 *  - we want subscribers (e.g. `useAutoSync`) to receive the same
 *    `emitLayerBreakerClosed` notification the cooldown-expiry path
 *    fires, so a sync attempt is scheduled immediately rather than
 *    waiting for the next 30s tick.
 *
 * Idempotent — calling on a closed breaker is a no-op (no log, no emit).
 * Logged at `console.info` so the action is visible in production traces
 * without elevating to `warn`.
 */
export function resetLayerBreakerOnUserActivity(reason: string): void {
  if (layerBreakerTrippedAt === null) return;
  const heldFor = Date.now() - layerBreakerTrippedAt;
  layerBreakerTrippedAt = null;
  layerBreakerConsecutiveTimeouts = 0;
  // Note: we deliberately DON'T bump `layerBreakerResetCount` here. The
  // exponential-backoff escalator exists to dampen automatic retry
  // pressure on a pathologically wedged queue; user-driven resets are
  // direct evidence the device isn't wedged, so subsequent automatic
  // trips should start from the base cooldown — not punish the user for
  // having retried.
  console.info(
    `[Offline Storage] Layer breaker manually closed via user activity (${reason}); held for ${Math.round(heldFor / 1000)}s`,
  );
  emitLayerBreakerClosed();
}

/**
 * Last-resort recovery: forcibly close the cached IDB handle, clear the
 * cached `dbPromise`, reset all breakers, and re-open. Use this from the
 * Sync Terminal "RECOVER STORAGE" button when `getDB()` itself is wedged
 * (e.g. another tab holds a blocking connection, or the SW is hung on an
 * IDB handle). Returns `true` on a successful re-open, `false` otherwise.
 *
 * Side effects:
 *  - Calls `db.close()` on the previously cached connection (best effort).
 *  - Sets `dbPromise = null` so the next `getDB()` does a fresh open.
 *  - Resets the layer breaker, per-store breakers, and timeout counters.
 *  - Posts `CLOSE_IDB_FOR_UPGRADE` to any active service worker so it
 *    drops its IDB handle before we try again.
 */
export async function forceCloseAndReopenDB(): Promise<boolean> {
  // 1. Close cached handle (best effort — may already be invalid).
  if (dbPromise) {
    try {
      const cached = await Promise.race([
        dbPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
      ]);
      try { (cached as IDBPDatabase<InspectionDB> | null)?.close?.(); } catch { /* ignore */ }
    } catch { /* ignore — wedged promise */ }
  }
  dbPromise = null;

  // 2. Ask the SW to release its IDB handle (bounded).
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);
      reg?.active?.postMessage({
        type: 'CLOSE_IDB_FOR_UPGRADE',
        dbName: 'rope-works-inspections',
        targetVersion: 19,
      });
    }
  } catch { /* ignore */ }

  // 3. Reset all breakers so the next call probes naturally.
  layerBreakerConsecutiveTimeouts = 0;
  layerBreakerTrippedAt = null;
  layerBreakerResetCount = 0;
  try { resetCircuitBreaker(); } catch { /* ignore */ }
  emitLayerBreakerClosed();

  console.info('[Offline Storage] forceCloseAndReopenDB: cache cleared, retrying open…');

  // 4. Attempt one fresh open. Wrap in a 6s timeout so the UI can
  //    surface the "close other tabs" message instead of spinning forever.
  try {
    await Promise.race([
      getDB(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('forceCloseAndReopenDB: still wedged')), 6000),
      ),
    ]);
    console.info('[Offline Storage] forceCloseAndReopenDB: re-open succeeded');
    return true;
  } catch (err) {
    console.warn('[Offline Storage] forceCloseAndReopenDB failed:', err);
    return false;
  }
}

/** Test-only inspection helper — reads internal state without exposing module-private vars. */
export function __test_only__getLayerBreakerStateForTests(): {
  consecutiveTimeouts: number;
  trippedAt: number | null;
  resetCount: number;
  cooldownMs: number;
} {
  return {
    consecutiveTimeouts: layerBreakerConsecutiveTimeouts,
    trippedAt: layerBreakerTrippedAt,
    resetCount: layerBreakerResetCount,
    cooldownMs: getLayerBreakerCooldownMs(),
  };
}

export const __test_only__LAYER_BREAKER_THRESHOLD = LAYER_BREAKER_THRESHOLD;
export const __test_only__LAYER_BREAKER_BASE_COOLDOWN_MS = LAYER_BREAKER_BASE_COOLDOWN_MS;
export const __test_only__LAYER_BREAKER_MAX_COOLDOWN_MS = LAYER_BREAKER_MAX_COOLDOWN_MS;
export const __test_only__recordLayerBoundaryTimeoutForTests = recordLayerBoundaryTimeout;
export const __test_only__recordLayerBoundarySuccessForTests = recordLayerBoundarySuccess;
/** Test-only inspection — returns the count of registered subscribers. */
export function __test_only__getLayerBreakerCloseSubscriberCount(): number {
  return layerBreakerCloseSubscribers.size;
}
/** Test-only inspection — returns the lastDbActivityAt timestamp. */
export function __test_only__getLastDbActivityAt(): number {
  return lastDbActivityAt;
}
// =====================================================================


function getBreakerState(store: BreakerStoreKey): BreakerState {
  let s = breakerStates.get(store);
  if (!s) {
    s = newBreakerState();
    breakerStates.set(store, s);
  }
  return s;
}

/**
 * Calculate current circuit breaker reset time with exponential backoff
 */
function getCircuitBreakerResetTime(store: BreakerStoreKey = 'global'): number {
  const s = getBreakerState(store);
  return Math.min(
    BASE_CIRCUIT_BREAKER_RESET_TIME * Math.pow(2, s.resetCount),
    MAX_CIRCUIT_BREAKER_RESET_TIME
  );
}

/**
 * Detect the existing IndexedDB version for `dbName` WITHOUT accidentally
 * creating an empty v1 database as a side effect.
 *
 * Background: `idb`'s `openDB(name)` (no version) opens at the current version
 * if the DB exists, but silently creates a fresh v1 DB if it does not. On a
 * cold-start profile this leaves an empty v1 alive when our caller actually
 * wants v18 — a subsequent `openDB(name, 18)` then has to perform a v1→v18
 * upgrade, can race against the dangling connection, and emits the
 * `[Offline Storage] DB upgrade blocked` warning seen in field reports.
 *
 * Strategy:
 *   1. Prefer `indexedDB.databases()` (Chromium / Safari / Firefox 126+). It
 *      returns metadata without opening a connection.
 *   2. Fall back to native `indexedDB.open(name)`. If we discover we just
 *      auto-created an empty v1 (no object stores), delete it before
 *      resolving so the next caller can perform a clean fresh-install upgrade.
 *
 * Returns 0 when the DB does not exist (or cannot be probed in <3s).
 *
 * Exported for unit-testing only.
 */
export async function detectExistingDBVersion(dbName: string): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;

  // Preferred path — non-creating enumeration.
  if (typeof indexedDB.databases === 'function') {
    try {
      const dbs = await indexedDB.databases();
      const existing = dbs.find((d) => d.name === dbName);
      return existing?.version ?? 0;
    } catch {
      /* fall through to native fallback */
    }
  }

  // Native fallback — clean up any accidental empty v1 we just created.
  return new Promise<number>((resolve) => {
    let resolved = false;
    const finish = (v: number) => {
      if (resolved) return;
      resolved = true;
      resolve(v);
    };
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(dbName);
    } catch {
      finish(0);
      return;
    }
    let createdEmpty = false;
    req.onupgradeneeded = () => {
      // We supplied no version, so this only fires when the DB did not
      // previously exist and the browser is auto-creating it at v1.
      createdEmpty = true;
    };
    req.onsuccess = () => {
      try {
        const db = req.result;
        const v = db.version;
        const isEmptyAccidental =
          createdEmpty || (v === 1 && db.objectStoreNames.length === 0);
        try { db.close(); } catch { /* ignore */ }
        if (isEmptyAccidental) {
          // Await the deletion before resolving — otherwise the empty v1
          // we just accidentally created is still alive when our caller
          // runs `openDB(name, DB_VERSION)`, which is exactly the race we
          // are trying to prevent.
          let deleteReq: IDBOpenDBRequest;
          try {
            deleteReq = indexedDB.deleteDatabase(dbName) as unknown as IDBOpenDBRequest;
          } catch {
            finish(0);
            return;
          }
          (deleteReq as unknown as IDBRequest).onsuccess = () => finish(0);
          (deleteReq as unknown as IDBRequest).onerror = () => finish(0);
          (deleteReq as unknown as { onblocked?: (() => void) | null }).onblocked = () => finish(0);
        } else {
          finish(v);
        }
      } catch {
        finish(0);
      }
    };
    req.onerror = () => finish(0);
    req.onblocked = () => finish(0);
    // Bound the wait — a hung probe must not block circuit-breaker recovery
    // or main-DB initialisation indefinitely.
    setTimeout(() => finish(0), 3000);
  });
}

/**
 * Run a lightweight IndexedDB probe to verify the connection is actually healthy
 * before re-enabling operations after a circuit breaker cooldown.
 *
 * Note: this previously called `openDB(name, undefined)`, which would
 * accidentally create an empty v1 database on cold-start profiles where the
 * circuit breaker fires before the main DB has been initialised. We now probe
 * via `detectExistingDBVersion` first and only open a real connection at the
 * version the DB is actually at — never causing an unintended upgrade.
 */
async function probeIndexedDB(): Promise<boolean> {
  if (circuitBreakerProbing) return false;
  circuitBreakerProbing = true;
  try {
    const existingVersion = await detectExistingDBVersion('rope-works-inspections');
    if (existingVersion <= 0) {
      // No DB yet — nothing to probe; the next real getDB() call will create it.
      return false;
    }
    const { data: db } = await withIDBTimeout(
      'probeIndexedDB:open',
      'light',
      () => openDB('rope-works-inspections', existingVersion),
      null,
    );
    if (!db) return false;
    // Lightweight count query to verify the connection is live
    const { data: count, timedOut } = await withIDBTimeout(
      'probeIndexedDB:count(inspections)',
      'light',
      () => db.count('inspections'),
      null as number | null
    );
    db.close();
    return !timedOut && count !== null;
  } catch {
    return false;
  } finally {
    circuitBreakerProbing = false;
  }
}

/**
 * Check if circuit breaker is open for a given store (defaults to 'global').
 */
function isCircuitBreakerOpen(store: BreakerStoreKey = 'global'): boolean {
  const s = getBreakerState(store);
  if (s.trippedAt) {
    const resetTime = getCircuitBreakerResetTime(store);
    if (Date.now() - s.trippedAt > resetTime) {
      // Cooldown expired — but don't reset yet. The probe will confirm health.
      // For synchronous callers, return false to allow a single operation attempt.
      // The probe runs asynchronously via scheduleCircuitBreakerProbe.
      s.trippedAt = null;
      s.failureCount = 0;
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Circuit breaker (${store}) cooldown expired (${resetTime / 1000}s, attempt #${s.resetCount + 1}) - probing...`);
      }
      // Schedule async probe — if it fails, the next operation timeout will re-trip
      scheduleCircuitBreakerProbe(store);
      return false;
    }
    return true; // Circuit is still open
  }
  return false;
}

/**
 * Schedule an async probe after circuit breaker cooldown expires.
 * If probe fails, re-trip with incremented backoff for the same store.
 */
function scheduleCircuitBreakerProbe(store: BreakerStoreKey): void {
  probeIndexedDB().then((healthy) => {
    const s = getBreakerState(store);
    if (healthy) {
      // Connection recovered — reset backoff counter for this store
      s.resetCount = 0;
      dbPromise = null; // Force fresh connection for real operations
      dbConnectionVerified = false;
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Circuit breaker probe succeeded (${store}) - fully re-enabled`);
      }
    } else {
      // Still broken — re-trip with higher backoff for this store
      s.resetCount++;
      recordIndexedDBFailure(store);
      recordIndexedDBFailure(store);
      recordIndexedDBFailure(store); // Trip immediately
      const nextResetTime = getCircuitBreakerResetTime(store);
      console.warn(`[Offline Storage] Circuit breaker probe failed (${store}) - re-tripping with ${nextResetTime / 1000}s backoff`);
    }
  });
}

/**
 * Record an IndexedDB failure for the given store's circuit breaker.
 */
function recordIndexedDBFailure(store: BreakerStoreKey = 'global'): void {
  const s = getBreakerState(store);
  s.failureCount++;
  if (s.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
    s.trippedAt = Date.now();
    const resetTime = getCircuitBreakerResetTime(store);
    console.warn(`[Offline Storage] Circuit breaker (${store}) tripped - disabled for ${resetTime / 1000}s after ${s.failureCount} failures (backoff #${s.resetCount})`);
  }
}

/**
 * Record an IndexedDB success - resets failure counter AND backoff for the store.
 */
function recordIndexedDBSuccess(store: BreakerStoreKey = 'global'): void {
  const s = getBreakerState(store);
  if (s.failureCount > 0) {
    s.failureCount = 0;
    s.trippedAt = null;
    s.resetCount = 0; // Full recovery — reset backoff
  }
}

/**
 * Get circuit breaker status (for debugging/UI). Aggregates across all stores —
 * `open` is true if ANY per-store breaker is currently open; `failureCount` is
 * the maximum across stores; `resetIn` is the longest remaining cooldown.
 * Per-store detail is exposed via the `byStore` map for diagnostics.
 */
export function getCircuitBreakerStatus(): {
  open: boolean;
  failureCount: number;
  resetIn: number | null;
  backoffLevel: number;
  fallbackActive: boolean;
  byStore: Record<string, { open: boolean; failureCount: number; resetIn: number | null; backoffLevel: number }>;
} {
  const byStore: Record<string, { open: boolean; failureCount: number; resetIn: number | null; backoffLevel: number }> = {};
  let anyOpen = false;
  let maxFailures = 0;
  let maxResetIn: number | null = null;
  let maxBackoff = 0;

  for (const [store, s] of breakerStates.entries()) {
    const open = isCircuitBreakerOpen(store);
    const resetTime = getCircuitBreakerResetTime(store);
    const resetIn = s.trippedAt ? Math.max(0, resetTime - (Date.now() - s.trippedAt)) : null;
    byStore[store] = { open, failureCount: s.failureCount, resetIn, backoffLevel: s.resetCount };
    if (open) anyOpen = true;
    if (s.failureCount > maxFailures) maxFailures = s.failureCount;
    if (resetIn !== null && (maxResetIn === null || resetIn > maxResetIn)) maxResetIn = resetIn;
    if (s.resetCount > maxBackoff) maxBackoff = s.resetCount;
  }

  return {
    open: anyOpen,
    failureCount: maxFailures,
    resetIn: maxResetIn,
    backoffLevel: maxBackoff,
    fallbackActive: anyOpen && isLocalStorageAvailable(),
    byStore,
  };
}

/**
 * Manually reset the circuit breaker so that user-initiated force sync
 * can proceed even after repeated failures. Resets ALL per-store breakers.
 */
export function resetCircuitBreaker(): void {
  breakerStates.clear();
  dbPromise = null; // Force fresh connection
  dbConnectionVerified = false;
  console.log('[Offline Storage] Circuit breaker manually reset (all stores)');
}

/**
 * Quick check if localStorage is functional (used to determine fallback status)
 */
function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__ls_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}
// ============= END CIRCUIT BREAKER =============

/**
 * Timeout limits by operation weight — prevents false empties on slow devices
 */
export const IDB_TIMEOUTS = {
  /** Single-key or small metadata reads */
  light: 5_000,
  /** Batch child-section reads (related data, training items, assessments) */
  batch: 10_000,
  /** Multi-store transactions or full-table scans */
  heavy: 15_000,
  /** Write operations (puts, deletes) */
  write: 8_000,
} as const;
export type TimeoutTier = keyof typeof IDB_TIMEOUTS;

/**
 * Steady-state IDB-open budget. Once the schema is at the current version,
 * `openDB` should resolve in well under a second; anything beyond this
 * threshold means the connection is genuinely hung (closed-but-cached
 * handle, SW holding a write transaction, OS-level lock) and we want to
 * fail fast so the caller can recover via the boundary path.
 *
 * Mobile gets a slightly larger budget because Safari bfcache restore +
 * iPad cold boot legitimately takes 5-6s in the worst case.
 */
const IDB_OPEN_TIMEOUT_STEADY_STATE_DESKTOP_MS = 5_000;
const IDB_OPEN_TIMEOUT_STEADY_STATE_MOBILE_MS = 8_000;

/**
 * Heavy-upgrade IDB-open budget. A cold-start v0 → DB_VERSION upgrade
 * chain creates ~14 stores + ~30 indexes + 3 row-by-row backfills (v17
 * dirty-flag stamping) + a post-upgrade fingerprint validation. On a
 * healthy local machine this completes in 200-800ms. On a busy GitHub
 * Actions runner with disk pressure (sibling jobs, I/O contention from
 * other PRs running concurrently on the shared physical host), the same
 * chain can take 4-7s — which used to fall right on the edge of the 5s
 * steady-state budget and surface as a Mode-1 flake on
 * `offline-edit-reconcile.spec.ts:141` (the inspection never reaches
 * IDB → autosync queue is empty → never syncs → 30s test timeout).
 *
 * The mobile budget gets the same 5s headroom on top of its steady-state
 * value: iPad cold boot + a real upgrade chain compounds.
 */
const IDB_OPEN_TIMEOUT_UPGRADE_DESKTOP_MS = 15_000;
const IDB_OPEN_TIMEOUT_UPGRADE_MOBILE_MS = 20_000;

/**
 * Pick the IDB-open timeout based on whether an upgrade is expected.
 *
 * Inputs:
 * - `existingVersion`: the result of `detectExistingDBVersion`. 0 means
 *   the DB does not yet exist (fresh install — full v0 → DB_VERSION
 *   upgrade chain about to run). Any value < `dbVersion` means a
 *   multi-version upgrade is expected. Equal means steady state.
 * - `dbVersion`: the target version we're about to open at.
 * - `mobile`: caller's `isMobile()` result. Mobile gets the slightly
 *   larger budget on both branches.
 * - `postOnlineRecovery` (Mode 6): true when a network `online` event
 *   fired within `POST_ONLINE_RECOVERY_GRACE_MS`. The first
 *   `openDB(DB_NAME, DB_VERSION)` call after `setOffline(true→false)`
 *   has been observed to take >5s on Playwright/Chromium CI runners,
 *   which exceeds the steady-state 5s/8s budget and triggers a
 *   ~2-minute cascade. Switching to the upgrade-grade budget while in
 *   the grace window prevents the wedge.
 *
 * Output: timeout in milliseconds for the `openDB` race.
 *
 * Exported so the contract can be unit-tested without spinning up a
 * real IDB. See `__tests__/offline-storage-idb-open-timeout.test.ts`
 * and `__tests__/idb-post-online-recovery.test.ts`.
 */
export function selectIdbOpenTimeout(
  existingVersion: number,
  dbVersion: number,
  mobile: boolean,
  postOnlineRecovery: boolean = false,
): number {
  // `existingVersion < dbVersion` covers both fresh-install (0) and any
  // multi-version upgrade (e.g. user on v15 opens app after the v18
  // schema lands). Negative or NaN values fall through to the upgrade
  // branch — same fail-safe shape as the `?? 0` default in `getDB`.
  // `postOnlineRecovery` joins the upgrade branch (Mode 6): the storage
  // layer is observably slow for ~2 minutes after a network toggle, so
  // we want the same headroom that a multi-version upgrade gets.
  const isUpgradeExpected =
    !Number.isFinite(existingVersion) || existingVersion < dbVersion;
  if (isUpgradeExpected || postOnlineRecovery) {
    return mobile
      ? IDB_OPEN_TIMEOUT_UPGRADE_MOBILE_MS
      : IDB_OPEN_TIMEOUT_UPGRADE_DESKTOP_MS;
  }
  return mobile
    ? IDB_OPEN_TIMEOUT_STEADY_STATE_MOBILE_MS
    : IDB_OPEN_TIMEOUT_STEADY_STATE_DESKTOP_MS;
}

/**
 * Wraps an IDB operation with a per-tier timeout.
 * Returns { data, timedOut } so callers can distinguish
 * real empties from timeout fallbacks.
 */
export async function withIDBTimeout<T, F = T>(
  operationName: string,
  tier: TimeoutTier,
  fn: () => Promise<T>,
  fallback: F
): Promise<{ data: T | F; timedOut: boolean }> {
  const ms = IDB_TIMEOUTS[tier];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[IDB] ${operationName} timed out after ${ms}ms (tier: ${tier})`));
    }, ms);
  });
  try {
    const data = await Promise.race([fn(), timeout]);
    return { data, timedOut: false };
  } catch (err) {
    const isTimeout = err instanceof Error && err.message.includes('timed out');
    console.warn(
      `[IDB] ${operationName} ${isTimeout ? 'timed out' : 'failed'}: ${err instanceof Error ? err.message : err}`
    );
    return { data: fallback, timedOut: isTimeout };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Helper to wrap a promise with a timeout
 */
// Track timeout suppression to avoid console spam
let timeoutWarningCount = 0;
let lastTimeoutLogAt = 0;
const TIMEOUT_LOG_INTERVAL = 30000; // Only log once per 30s

function withTimeout<T, F = T>(promise: Promise<T>, timeoutMs: number, fallbackValue: F): Promise<T | F> {
  return Promise.race<T | F>([
    promise,
    new Promise<F>((resolve) => setTimeout(() => {
      // Suppress repeated timeout warnings to reduce console noise
      timeoutWarningCount++;
      const now = Date.now();
      if (now - lastTimeoutLogAt > TIMEOUT_LOG_INTERVAL) {
        const suppressed = timeoutWarningCount - 1;
        console.warn(`[Offline Storage] Operation timed out after ${timeoutMs}ms${suppressed > 0 ? ` (${suppressed} similar warnings suppressed)` : ''}`);
        timeoutWarningCount = 0;
        lastTimeoutLogAt = now;
      }
      resolve(fallbackValue);
    }, timeoutMs))
  ]);
}

/**
 * Check if IndexedDB is available and healthy (with 30s cache)
 */
export async function checkIndexedDBHealth(): Promise<boolean> {
  if (!('indexedDB' in window)) {
    console.error('[Offline Storage] IndexedDB not available');
    return false;
  }

  // Return cached result if still valid
  const now = Date.now();
  if (healthCheckCache && (now - healthCheckCache.timestamp) < HEALTH_CHECK_TTL) {
    return healthCheckCache.isHealthy;
  }

  try {
    // Try to open a test database with a 3-second timeout to prevent hangs
    const healthCheckPromise = (async () => {
      const testDb = await openDB('health-check', 1);
      testDb.close();
      return true;
    })();
    
    const result = await withTimeout(healthCheckPromise, 3000, false);
    
    // Cache the result
    healthCheckCache = { isHealthy: result, timestamp: now };
    
    if (!result) {
      console.warn('[Offline Storage] IndexedDB health check timed out - proceeding anyway');
      // Return true anyway to allow loading to continue - we'll handle errors per-operation
      healthCheckCache = { isHealthy: true, timestamp: now };
      return true;
    }
    
    return true;
  } catch (error) {
    console.error('[Offline Storage] IndexedDB health check failed:', error);
    
    // Cache the failed result
    healthCheckCache = { isHealthy: false, timestamp: now };
    return false;
  }
}

/**
 * Request persistent storage and check quota with timeout protection
 */
async function ensureStorage(): Promise<void> {
  // Request persistent storage with timeout (important on mobile, but shouldn't block loading)
  const storagePromise = (async () => {
    const isPersisted = await requestPersistentStorage();
    
    if (!isPersisted && !storageWarningShown) {
      console.warn('[Offline Storage] Persistent storage not granted - data may be cleared by browser');
      storageWarningShown = true;
      // Note: previously surfaced as a user-facing toast. Now console-only —
      // the persistent NetworkStatusBanner already covers offline state, and
      // popping a toast every session was alarming users without an actionable
      // remedy. Genuine save failures still raise destructive toasts below.
    }

    // Check storage quota
    const quota = await checkStorageQuota();
    
    if (quota.percentUsed > 80 && !storageWarningShown) {
      console.warn('[Offline Storage] Storage almost full:', quota.percentUsed.toFixed(2) + '%');
      storageWarningShown = true;
    }
  })();
  
  // Don't let storage checks block loading - timeout after 2 seconds
  await withTimeout(storagePromise, 2000, undefined);
}

/**
 * Gap 2.2 dead-letter ring buffer (sessionStorage).
 * IDB has already failed when this is invoked, so we cannot persist to IDB.
 * sessionStorage survives the current tab session and lets diagnostics surface
 * "N records could not be saved this session." Cap at 20 entries (FIFO eviction).
 */
export type EmergencyFallbackFailure = {
  code: 'localstorage_quota' | 'localstorage_blocked' | 'localstorage_unknown';
  reportType: string;
  id: string;
  operationName: string;
  approxBytes: number;
  ts: number;
};

const EMERGENCY_FAILURE_KEY = 'rw_emergency_fallback_failures';
const EMERGENCY_FAILURE_MAX = 20;

function recordEmergencyFallbackFailure(entry: EmergencyFallbackFailure): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    let arr: EmergencyFallbackFailure[] = [];
    try {
      const raw = sessionStorage.getItem(EMERGENCY_FAILURE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) arr = parsed;
      }
    } catch {
      arr = [];
    }
    arr.push(entry);
    if (arr.length > EMERGENCY_FAILURE_MAX) {
      arr = arr.slice(arr.length - EMERGENCY_FAILURE_MAX);
    }
    sessionStorage.setItem(EMERGENCY_FAILURE_KEY, JSON.stringify(arr));
  } catch {
    // sessionStorage may also be full / blocked — best-effort, never throw
  }
}

/**
 * Read accessor for diagnostics UI. Returns the in-session list of records
 * that could not be persisted to either IDB or localStorage.
 */
export function getEmergencyFallbackFailures(): EmergencyFallbackFailure[] {
  try {
    if (typeof sessionStorage === 'undefined') return [];
    const raw = sessionStorage.getItem(EMERGENCY_FAILURE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Classify a localStorage write error so we can route to the right diagnostic.
 */
function classifyLocalStorageError(
  err: unknown,
): 'localstorage_quota' | 'localstorage_blocked' | 'localstorage_unknown' {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; code?: number };
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
      return 'localstorage_quota';
    }
    if (e.name === 'SecurityError') {
      return 'localstorage_blocked';
    }
  }
  return 'localstorage_unknown';
}

/**
 * Evict the oldest already-synced `rw_backup_*` snapshots from localStorage
 * to free up at least `bytesNeeded` bytes (UTF-16 estimate).
 *
 * Mirrors the pattern in `local-backup-ledger.ts:evictIfNeeded` but is invoked
 * reactively from `emergencyLocalStorageFallback` only when a write has just
 * thrown `QuotaExceededError`. Unsynced snapshots are never evicted — they are
 * still the only client-side copy of the user's work.
 *
 * Returns the number of bytes actually freed (caller decides whether to retry).
 *
 * Exported for unit testing only — production callers should use
 * `emergencyLocalStorageFallback` which calls this internally.
 */
export function evictSyncedBackupSnapshots(bytesNeeded: number): number {
  if (typeof localStorage === 'undefined' || bytesNeeded <= 0) return 0;

  type Entry = { key: string; ts: number; bytes: number };
  const synced: Entry[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('rw_backup_')) continue;
    const value = localStorage.getItem(key);
    if (!value) continue;
    const bytes = key.length * 2 + value.length * 2; // UTF-16
    try {
      const snapshot = JSON.parse(value) as { synced?: boolean; ts?: number };
      if (snapshot && snapshot.synced === true) {
        synced.push({ key, ts: typeof snapshot.ts === 'number' ? snapshot.ts : 0, bytes });
      }
    } catch {
      // Corrupt snapshot — safe to evict (it was unreadable anyway)
      synced.push({ key, ts: 0, bytes });
    }
  }

  // Oldest first
  synced.sort((a, b) => a.ts - b.ts);

  let freed = 0;
  for (const entry of synced) {
    if (freed >= bytesNeeded) break;
    try {
      localStorage.removeItem(entry.key);
      freed += entry.bytes;
    } catch {
      // removeItem can in theory throw on a corrupt store — ignore and keep going
    }
  }

  if (freed > 0) {
    console.warn(
      `[Offline Storage] Evicted ${synced.length} synced snapshot(s), freed ${(freed / 1024).toFixed(1)}KB`,
    );
  }
  return freed;
}

/**
 * Emergency localStorage fallback for write operations when circuit breaker is open.
 * Attempts to persist critical report data via the backup ledger so it isn't lost.
 *
 * Gap 2.2: when this returns false the caller (`withIndexedDBSaveBoundary`) throws
 * `IdbSaveError('storage_unavailable')` so the form auto-save UI surfaces the
 * persistent "Save failed" state. We additionally classify + log the failure and
 * record it to a sessionStorage ring buffer for later diagnostics.
 */
function emergencyLocalStorageFallback(operationName: string, data: unknown): boolean {
  // Only attempt for report-level saves that carry meaningful data
  if (!data || typeof data !== 'object') return false;
  const rec = data as Record<string, unknown>;
  const id = rec.id;
  if (!id || typeof id !== 'string') return false;

  let reportType: 'inspection' | 'training' | 'daily_assessment' | null = null;
  const opLower = operationName.toLowerCase();
  if (opLower.includes('inspection')) reportType = 'inspection';
  else if (opLower.includes('training')) reportType = 'training';
  else if (opLower.includes('assessment') || opLower.includes('daily')) reportType = 'daily_assessment';

  if (!reportType) return false;

  // Build snapshot up-front so `json.length` is available in the failure path
  const key = `rw_backup_${reportType}_${id}`;
  let json = '';
  try {
    const snapshot = {
      v: 1,
      ts: Date.now(),
      synced: false,
      device: isMobile() ? 'mobile' : 'desktop',
      parent: rec,
      children: {},
    };
    json = JSON.stringify(snapshot);
    try {
      localStorage.setItem(key, json);
    } catch (writeErr: unknown) {
      // On quota exhaustion, evict the oldest already-synced snapshots and
      // retry once. Unsynced snapshots are never evicted — they may be the
      // only client-side copy of the user's in-progress work.
      if (classifyLocalStorageError(writeErr) === 'localstorage_quota') {
        // Aim to free ~2x the inbound payload so subsequent emergency saves
        // in the same session don't immediately re-trip the same quota.
        const bytesNeeded = (key.length + json.length) * 2 * 2;
        const freed = evictSyncedBackupSnapshots(bytesNeeded);
        if (freed > 0) {
          // Retry once. If this throws again, the outer catch handles it.
          localStorage.setItem(key, json);
        } else {
          throw writeErr;
        }
      } else {
        throw writeErr;
      }
    }
    console.warn(
      `[Offline Storage] Emergency localStorage save for ${reportType} ${id.substring(0, 8)} (${(json.length / 1024).toFixed(1)}KB)`,
    );
    return true;
  } catch (err: unknown) {
    const code = classifyLocalStorageError(err);
    const approxBytes = json.length;

    // Operational signal — always logged, not gated by debug flag
    console.error('[Offline Storage] Emergency localStorage fallback FAILED', {
      code,
      reportType,
      id: id.substring(0, 8),
      op: operationName,
      bytes: approxBytes,
      error: err,
    });

    // Forward to centralized error logger → audit_logs.client.error (best-effort)
    try {
      void import('./log-error').then(({ logError }) => {
        try {
          logError(err, {
            scope: 'emergency-localstorage-fallback',
            extra: {
              code,
              reportType,
              id: id.substring(0, 8),
              operationName,
              approxBytes,
            },
          });
        } catch {
          /* swallow */
        }
      });
    } catch {
      /* dynamic import failure — never throw out of fallback */
    }

    // Persist to sessionStorage ring buffer for SyncDiagnosticsSheet
    recordEmergencyFallbackFailure({
      code,
      reportType,
      id,
      operationName,
      approxBytes,
      ts: Date.now(),
    });

    // Best-effort user-visible notification (dynamic import — never throws)
    try {
      void import('./notification-center').then(({ addSyncNotification }) => {
        try {
          const failures = getEmergencyFallbackFailures();
          addSyncNotification(
            `Storage is full — ${failures.length} record(s) could NOT be saved. Free space immediately.`,
          );
        } catch {
          /* swallow */
        }
      });
    } catch {
      /* swallow */
    }

    return false;
  }
}

// Track if DB has been successfully opened (skip health check after first success)
let dbConnectionVerified = false;

// Mode 6: Multiplier applied to a boundary's per-op `OPERATION_TIMEOUT` when
// inside the post-online recovery grace window. Mirrors the upgrade-grade
// budget escalation that `selectIdbOpenTimeout` already applies to the
// `openDB` race during the same window — without this, the boundary's outer
// `withTimeout` would fire BEFORE the slow recovering open/op had a chance
// to complete, re-introducing the cascade.
//
// Mode 7A — bumped 3 → 4 after PR #104's CI run still showed individual
// boundary ops timing out at the 3× ceiling. 4× takes `light` (5s) → 20s,
// `batch` (10s) → 40s, `write` (8s) → 32s, `heavy` (15s) → 60s, comfortably
// above the worst observed wedge tail without going so wide that a *real*
// hung DB on a non-recovering device sits behind a 60s+ spinner.
const POST_ONLINE_GRACE_TIMEOUT_MULTIPLIER = 4;

/**
 * @returns the per-op boundary timeout, widened by
 * `POST_ONLINE_GRACE_TIMEOUT_MULTIPLIER` when we're inside the post-online
 * recovery grace window (Mode 6, calibration updated by Mode 7A). Pure
 * function over the input so the contract can be unit-tested via the
 * exported `setLastOnlineRecoveryAtForTests` setter.
 */
export function applyPostOnlineGraceBump(timeoutMs: number, now: number = Date.now()): number {
  return isInPostOnlineRecoveryGrace(now) ? timeoutMs * POST_ONLINE_GRACE_TIMEOUT_MULTIPLIER : timeoutMs;
}

// ============================================================================
// S11: Tagged IDB read failure sentinel.
// The default `withIndexedDBErrorBoundary` returns `fallbackValue` on failure,
// which makes "read failed" indistinguishable from "no rows" at every call
// site (the unsynced badge silently reads 0 when IDB is unhealthy).
// `withIndexedDBReadBoundary` is a parallel helper used by the few read paths
// that gate user-visible sync state (unsynced inspections / trainings /
// assessments / unuploaded photos). It returns a tagged failure object that
// callers MUST inspect via `isIdbReadFailure` so the badge keeps the
// last-known count and the existing `syncError` UI lights up instead.
// ============================================================================
export const IDB_READ_FAILED = Symbol.for('rw.idb-read-failed');
export type IdbReadFailure = {
  __idbReadFailed: typeof IDB_READ_FAILED;
  error: string;
  context: string;
};

export function isIdbReadFailure(v: unknown): v is IdbReadFailure {
  return !!v && typeof v === 'object' && (v as { __idbReadFailed?: unknown }).__idbReadFailed === IDB_READ_FAILED;
}

function makeIdbReadFailure(context: string, error: unknown): IdbReadFailure {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown');
  return { __idbReadFailed: IDB_READ_FAILED, error: message, context };
}

/**
 * Mode 11A/B — alternate-read fallback whenever IDB returns `IdbReadFailure`.
 *
 * The browser-internal `IDBOpenDBRequest` queue can wedge for 4-6 minutes
 * after an offline→online toggle on Playwright/Chromium CI runners (W3C
 * spec has no abort path; see `mode-11-localbackupledger-alt-read-diagnostic.md`).
 * Mode 8A bounds the blast radius via fast-fail when the layer breaker
 * trips, but the autosync drain still can't read its work queue → no
 * progress until the queue drains naturally.
 *
 * `LocalBackupLedger` is a parallel system-of-record (every IDB write is
 * mirrored via `saveReportSnapshot`, unsynced snapshots explicitly never
 * evicted), and localStorage reads are synchronous and structurally cannot
 * wedge. We route the unsynced-records read through the ledger so the
 * drain can complete despite the wedge.
 *
 * Mode 11B (PR #118 follow-up) — the fallback now fires on ANY
 * `IdbReadFailure`, not just when the layer breaker is confirmed open.
 * Rationale: in CI we observed the autosync drain calling
 * `getUnsynced{Inspections,Trainings,DailyAssessments}` BEFORE the breaker
 * had accumulated 3 consecutive timeouts (the threshold to trip). The
 * wrapper saw `IdbReadFailure` from the inner timeout, checked the
 * breaker (still closed, only 1-2 timeouts in), and propagated the
 * failure unchanged. The autosync caller then set `unsynced = []` and
 * exited without ever consulting the ledger. By the time the breaker
 * tripped (~96s into the wedge), the spec budget had elapsed.
 *
 * The breaker gate was over-conservative: the ledger is a system-of-record
 * so returning ledger rows is strictly more useful than the sentinel even
 * for transient failures. Callers that want to preserve last-known counts
 * can still detect the empty-ledger / failed-fallback path via the
 * `idbError` log line.
 */
type LedgerReportType = 'inspection' | 'training' | 'daily_assessment';
type WedgeLedgerFallbackOptions = { allowLedgerFallback?: boolean };
async function withWedgeLedgerFallback<T extends { id?: string }>(
  reader: () => Promise<T[] | IdbReadFailure>,
  reportType: LedgerReportType,
  userId: string | undefined,
  context: string,
  options: WedgeLedgerFallbackOptions = {},
): Promise<T[] | IdbReadFailure> {
  const result = await reader();
  if (!isIdbReadFailure(result)) return result;
  if (options.allowLedgerFallback === false) return result;

  try {
    const { listUnsyncedDbRowsFromLedger } = await import('./local-backup-ledger');
    const ledgerRows = listUnsyncedDbRowsFromLedger(reportType, userId) as unknown as T[];
    console.warn('[Offline Storage] Mode 11A ledger fallback active', {
      context,
      reportType,
      breakerOpen: isIdbLayerBreakerOpen(),
      ledgerCount: ledgerRows.length,
      idbError: result.error,
    });
    return ledgerRows;
  } catch (err) {
    console.warn(
      '[Offline Storage] Mode 11A ledger fallback failed; propagating IdbReadFailure',
      { context, err },
    );
    return result;
  }
}

/**
 * Strict read boundary for sync-gating reads. Unlike `withIndexedDBErrorBoundary`
 * (which silently swallows errors and returns `fallbackValue`), this returns
 * `IdbReadFailure` so the caller can preserve last-known state and surface
 * a real error to the user.
 *
 * Mirrors the same circuit-breaker / timeout / health-check semantics as the
 * silent boundary so sync paths don't regress on resilience.
 */
export type IdbReadTier = 'light' | 'batch' | 'write' | 'photo';

async function withIndexedDBReadBoundary<T>(
  operation: () => Promise<T>,
  operationName: string,
  options?: { tier?: IdbReadTier; store?: BreakerStoreKey },
): Promise<T | IdbReadFailure> {
  // M5: Per-store breaker. Default 'global' for legacy callers.
  const store: BreakerStoreKey = options?.store ?? 'global';

  // Mode 8A — layer-level queue-stuck breaker. Independent of per-store
  // dilution; protects the underlying IDBOpenDBRequest queue from
  // additional pile-on while it drains.
  if (isIdbLayerBreakerOpen()) {
    if (import.meta.env.DEV) {
      console.log(`[Offline Storage] Layer breaker open, returning IdbReadFailure for ${operationName}`);
    }
    return makeIdbReadFailure(operationName, 'idb_layer_breaker_open');
  }

  if (isCircuitBreakerOpen(store)) {
    if (import.meta.env.DEV) {
      console.log(`[Offline Storage] Circuit breaker (${store}) open, returning IdbReadFailure for ${operationName}`);
    }
    return makeIdbReadFailure(operationName, 'circuit_breaker_open');
  }

  // M2: Tier is now an EXPLICIT parameter. The previous substring-match
  // classifier (`opLowerForTier.includes('photo' | 'training' | …)`) was
  // fragile — a future op named "TrainingPhotoMeta" would silently pick the
  // photo path. Callers must pass `{ tier }`; we fall back to substring
  // inference only for legacy callers that haven't been migrated, and DEV
  // warns so they get fixed.
  let OPERATION_TIMEOUT: number;
  if (options?.tier) {
    OPERATION_TIMEOUT =
      options.tier === 'batch' ? IDB_TIMEOUTS.batch :
      options.tier === 'write' || options.tier === 'photo' ? IDB_TIMEOUTS.write :
      IDB_TIMEOUTS.light;
  } else {
    if (import.meta.env.DEV) {
      console.warn(`[Offline Storage] withIndexedDBReadBoundary("${operationName}") called without explicit tier — falling back to substring inference. Pass { tier } to fix.`);
    }
    const opLowerForTier = operationName.toLowerCase();
    if (opLowerForTier.includes('photo')) {
      OPERATION_TIMEOUT = IDB_TIMEOUTS.write;
    } else if (
      opLowerForTier.includes('batch') ||
      opLowerForTier.includes('related') ||
      opLowerForTier.includes('training') ||
      opLowerForTier.includes('assessment') ||
      opLowerForTier.includes('getall') ||
      opLowerForTier.includes('unsynced')
    ) {
      OPERATION_TIMEOUT = IDB_TIMEOUTS.batch;
    } else {
      OPERATION_TIMEOUT = IDB_TIMEOUTS.light;
    }
  }
  // Mode 6: widen the boundary's per-op budget while we're inside the
  // post-online recovery grace window. Without this, the outer
  // `withTimeout` would fire BEFORE the slow recovering open/op had a
  // chance to complete, re-introducing the cascade documented in
  // `mode-6-idb-wedge-after-offline-toggle.md`.
  OPERATION_TIMEOUT = applyPostOnlineGraceBump(OPERATION_TIMEOUT);
  const TIMEOUT_SENTINEL = Symbol('timeout');

  try {
    const result = await withTimeout(
      (async () => {
        if (!dbConnectionVerified) {
          const isHealthy = await checkIndexedDBHealth();
          if (!isHealthy) {
            throw new Error('idb_unhealthy');
          }
          dbConnectionVerified = true;
        }
        return await operation();
      })(),
      OPERATION_TIMEOUT,
      TIMEOUT_SENTINEL,
    );

    if (result === TIMEOUT_SENTINEL) {
      console.warn(`[Offline Storage] Read timeout for ${operationName}, resetting DB connection`);
      dbConnectionVerified = false;
      recordIndexedDBFailure(store);
      recordLayerBoundaryTimeout();
      if (dbPromise) {
        dbPromise.then(db => db.close()).catch(() => {});
        dbPromise = null;
      }
      return makeIdbReadFailure(operationName, 'idb_read_timeout');
    }

    recordIndexedDBSuccess(store);
    recordLayerBoundarySuccess();
    return result as T;
  } catch (err) {
    // Audit M4: iOS Safari closing-connection — surface as IdbReadFailure so
    // the caller still preserves last-known UI state, but skip the breaker so
    // the next attempt after page resume isn't gated by a cooldown.
    if (isIdbClosingError(err)) {
      if (import.meta.env.DEV) {
        console.info(`[Offline Storage] Read skipped — IDB closing in ${operationName}`);
      }
      dbConnectionVerified = false;
      // Discard the cached connection: the resolved `dbPromise` holds a
      // closed IDBDatabase handle, and `getDB()` would otherwise keep
      // returning it on every call after bfcache restore. `checkIndexedDBHealth`
      // opens a *separate* probe DB so it can't notice. Mirror the timeout
      // recovery pattern (see lines below) so the next op opens a fresh
      // connection.
      if (dbPromise) {
        dbPromise.then(db => db.close()).catch(() => {});
        dbPromise = null;
      }
      return makeIdbReadFailure(operationName, 'idb_closing');
    }
    console.error(`[Offline Storage] Read failed for ${operationName}:`, err);
    recordIndexedDBFailure(store);
    return makeIdbReadFailure(operationName, err);
  }
}

/**
 * Wrapper for IndexedDB operations with error boundary, timeout protection, and circuit breaker
 * Prevents any single IndexedDB operation from blocking the app
 * OPTIMIZED: Skips redundant health checks after first successful DB connection
 * CIRCUIT BREAKER: Fails fast after repeated failures
 */
// ============================================================================
// Gap 2.1: Strict save boundary that THROWS on failure.
// `withIndexedDBErrorBoundary` swallows errors and returns `fallbackValue`,
// which makes save-failures look like successes to the caller — the form
// clears its dirty flag and the user navigates away losing data.
//
// `withIndexedDBSaveBoundary` is a parallel wrapper used by the three
// user-facing report saves (saveInspectionOffline / saveTrainingOffline /
// saveDailyAssessmentOffline). On failure it throws an `IdbSaveError` so
// callers can KEEP the dirty flag, SKIP appendVersion(), and surface the
// failure persistently in the AutoSaveIndicator.
//
// Returns `{ savedToBackup: true }` when the circuit breaker is open and the
// emergency localStorage fallback succeeds (caller knows the row is in
// localStorage, not IDB, but data is safe).
// ============================================================================
export type IdbSaveErrorCode =
  | 'idb_unhealthy'
  | 'idb_closing'
  | 'timeout'
  | 'quota_exceeded'
  | 'storage_unavailable'
  | 'REQUIRED_FIELD_MISSING'
  | 'unknown';

export class IdbSaveError extends Error {
  readonly code: IdbSaveErrorCode;
  readonly operationName: string;
  readonly cause?: unknown;
  constructor(code: IdbSaveErrorCode, operationName: string, cause?: unknown) {
    super(`[${operationName}] save failed: ${code}`);
    this.name = 'IdbSaveError';
    this.code = code;
    this.operationName = operationName;
    this.cause = cause;
  }
}

export function isIdbSaveError(e: unknown): e is IdbSaveError {
  if (e instanceof IdbSaveError) return true;
  if (!e || typeof e !== 'object') return false;
  const o = e as { name?: unknown; code?: unknown };
  return o.name === 'IdbSaveError' && typeof o.code === 'string';
}

/**
 * Mode 14: structured diagnostic snapshot attached to `IdbSaveError.cause`
 * so downstream Sentry events surface enough context to triage which
 * sub-step blew the budget without a follow-up code change.
 *
 * Captured fields (all best-effort; helper never throws):
 *   - `probeMs`: time spent in `checkIndexedDBHealth` before the op started
 *   - `opMs`: time spent inside the `operation()` body
 *   - `elapsedMs`: total wall-clock time inside the boundary
 *   - `timeoutMs`: actual budget used (post-grace-bump)
 *   - `inPostOnlineGrace`: true when the wider Mode-6 budget is active
 *   - `layerBreakerOpen`: true when the Mode-8A layer breaker is tripped
 *   - `breakerOpen`: true when ANY per-store breaker is tripped
 *   - `breakerFailureCount`: max failure count across stores
 *   - `breakerByStore`: per-store breaker summary (open / failureCount / resetIn)
 *   - `quotaBytes`, `usageBytes`, `usagePct`: `navigator.storage.estimate()`
 *     output (raced against a 1 s timeout — Safari can hang here while wedged)
 *   - `persisted`: `navigator.storage.persisted()` output (raced 500 ms)
 *   - `userAgent`, `platform`: browser/OS detection for triage
 *
 * `log-error.ts` flattens this object into Sentry's `extra` so the fields
 * become searchable / filterable on the Issue page.
 */
export type IdbSaveDiagnostics = {
  store: string;
  probeMs?: number;
  opMs?: number;
  elapsedMs: number;
  timeoutMs: number;
  inPostOnlineGrace: boolean;
  layerBreakerOpen?: boolean;
  breakerOpen?: boolean;
  breakerFailureCount?: number;
  breakerByStore?: Record<string, { open: boolean; failureCount: number; resetIn: number | null; backoffLevel: number }>;
  quotaBytes?: number;
  usageBytes?: number;
  usagePct?: number | null;
  persisted?: boolean | null;
  userAgent?: string;
  platform?: string;
};

async function captureIdbSaveDiagnostics(input: {
  store: BreakerStoreKey;
  probeMs?: number;
  opMs?: number;
  elapsedMs: number;
  timeoutMs: number;
}): Promise<IdbSaveDiagnostics> {
  const out: IdbSaveDiagnostics = {
    store: input.store,
    probeMs: input.probeMs,
    opMs: input.opMs,
    elapsedMs: input.elapsedMs,
    timeoutMs: input.timeoutMs,
    inPostOnlineGrace: false,
  };
  try { out.inPostOnlineGrace = isInPostOnlineRecoveryGrace(); } catch { /* swallow */ }
  try { out.layerBreakerOpen = isIdbLayerBreakerOpen(); } catch { /* swallow */ }
  try {
    const status = getCircuitBreakerStatus();
    out.breakerOpen = status.open;
    out.breakerFailureCount = status.failureCount;
    out.breakerByStore = status.byStore;
  } catch { /* swallow */ }
  if (typeof navigator !== 'undefined') {
    try { out.userAgent = navigator.userAgent; } catch { /* swallow */ }
    try { out.platform = navigator.platform; } catch { /* swallow */ }
  }
  // Storage estimate — race against a short timeout. Safari can hang here
  // while IDB is wedged, and we don't want diagnostic capture to block the
  // failure path or leak time onto the user's perceived save latency.
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await Promise.race<StorageEstimate | null>([
        navigator.storage.estimate(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);
      if (est) {
        out.quotaBytes = est.quota;
        out.usageBytes = est.usage;
        out.usagePct = est.quota && est.quota > 0 && typeof est.usage === 'number'
          ? Math.round((est.usage / est.quota) * 100)
          : null;
      }
    }
  } catch { /* swallow */ }
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
      out.persisted = await Promise.race<boolean | null>([
        navigator.storage.persisted(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
      ]);
    }
  } catch { /* swallow */ }
  return out;
}

export const __test_only__captureIdbSaveDiagnosticsForTests = captureIdbSaveDiagnostics;

export type SaveResult = { savedToBackup: boolean };

/**
 * Audit M3: notify useAutoSync that a record was just saved (or the dirty
 * count otherwise changed). The hook listens for `sync-records-updated`
 * and reschedules its periodic-sync interval from `idleSyncInterval`
 * (long, used when nothing is dirty) down to `activeSyncInterval` (short,
 * used when there are unsynced records). Best-effort — a failure to
 * dispatch must never break the underlying save.
 */
function dispatchSyncRecordsUpdated(): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sync-records-updated'));
    }
  } catch {
    /* ignore */
  }
}

async function withIndexedDBSaveBoundary(
  operation: () => Promise<void>,
  operationName: string,
  parentDataForFallback?: unknown,
  options?: { store?: BreakerStoreKey },
): Promise<SaveResult> {
  const store: BreakerStoreKey = options?.store ?? 'global';
  // Mode 8A — layer-level queue-stuck breaker. Treats a wedged IDB queue
  // the same as a tripped per-store breaker for save-path purposes:
  // attempt the localStorage emergency fallback, then throw so the caller
  // still surfaces a failure (mirrors the existing per-store breaker
  // behaviour below).
  if (isIdbLayerBreakerOpen()) {
    if (import.meta.env.DEV) {
      console.log(`[Offline Storage] Layer breaker open, attempting localStorage fallback for ${operationName}`);
    }
    const fallbackSucceeded = parentDataForFallback
      ? emergencyLocalStorageFallback(operationName, parentDataForFallback)
      : false;
    if (fallbackSucceeded) return { savedToBackup: true };
    throw new IdbSaveError('storage_unavailable', operationName);
  }
  // Circuit breaker open — try emergency localStorage write
  if (isCircuitBreakerOpen(store)) {
    if (import.meta.env.DEV) {
      console.log(`[Offline Storage] Circuit breaker (${store}) open, attempting localStorage fallback for ${operationName}`);
    }
    const fallbackSucceeded = parentDataForFallback
      ? emergencyLocalStorageFallback(operationName, parentDataForFallback)
      : false;

    // Only surface a toast when the emergency localStorage fallback failed.
    // The "data was saved to backup storage" path is intentionally silent —
    // it's recoverable and used to spam users with a scary banner on every save.
    try {
      const cbWarningKey = 'circuit-breaker-warning-shown';
      if (!fallbackSucceeded && typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(cbWarningKey)) {
        sessionStorage.setItem(cbWarningKey, 'true');
        import('@/hooks/use-toast').then(({ toast }) => {
          toast({
            title: 'Storage unavailable',
            description: 'Your changes are NOT saved. Stay on this page until storage recovers.',
            variant: 'destructive',
          });
        }).catch(() => {});
        const resetTime = getCircuitBreakerResetTime(store);
        setTimeout(() => sessionStorage.removeItem(cbWarningKey), resetTime + 1000);
      }
    } catch { /* ignore */ }

    if (fallbackSucceeded) return { savedToBackup: true };
    throw new IdbSaveError('storage_unavailable', operationName);
  }

  // Pick timeout tier (mirror silent boundary)
  const opLowerForTier = operationName.toLowerCase();
  let OPERATION_TIMEOUT: number;
  if (opLowerForTier.includes('photo')) {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.write;
  } else if (
    opLowerForTier.includes('batch') ||
    opLowerForTier.includes('related') ||
    opLowerForTier.includes('training') ||
    opLowerForTier.includes('assessment') ||
    opLowerForTier.includes('getall') ||
    opLowerForTier.includes('unsynced')
  ) {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.batch;
  } else if (opLowerForTier.includes('save') || opLowerForTier.includes('delete') || opLowerForTier.includes('put')) {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.write;
  } else {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.light;
  }
  // Mode 6: widen the boundary's per-op budget while we're inside the
  // post-online recovery grace window. Mirrors the open-side bump in
  // `selectIdbOpenTimeout(..., postOnlineRecovery=true)` so the outer
  // race doesn't fire before the underlying save can complete.
  OPERATION_TIMEOUT = applyPostOnlineGraceBump(OPERATION_TIMEOUT);
  const TIMEOUT_SENTINEL = Symbol('timeout');

  // Mode 14: per-step timing for telemetry. Captured by closure and surfaced
  // on `IdbSaveError.cause` when we throw, so Sentry can pinpoint whether
  // the budget was eaten by the health probe or by the operation body.
  const boundaryStart = Date.now();
  let probeMs: number | undefined;
  let opMs: number | undefined;

  try {
    const result = await withTimeout(
      (async () => {
        if (!dbConnectionVerified) {
          const probeStart = Date.now();
          const isHealthy = await checkIndexedDBHealth();
          probeMs = Date.now() - probeStart;
          if (!isHealthy) {
            throw new IdbSaveError('idb_unhealthy', operationName);
          }
          dbConnectionVerified = true;
        }
        const opStart = Date.now();
        await operation();
        opMs = Date.now() - opStart;
        return 'ok' as const;
      })(),
      OPERATION_TIMEOUT,
      TIMEOUT_SENTINEL,
    );

    if (result === TIMEOUT_SENTINEL) {
      console.warn(`[Offline Storage] Save timeout for ${operationName}, resetting DB connection`);
      dbConnectionVerified = false;
      recordIndexedDBFailure(store);
      recordLayerBoundaryTimeout();
      if (dbPromise) {
        dbPromise.then(db => db.close()).catch(() => {});
        dbPromise = null;
      }
      const diag = await captureIdbSaveDiagnostics({
        store,
        probeMs,
        opMs,
        elapsedMs: Date.now() - boundaryStart,
        timeoutMs: OPERATION_TIMEOUT,
      });
      throw new IdbSaveError('timeout', operationName, diag);
    }

    recordIndexedDBSuccess(store);
    recordLayerBoundarySuccess();
    return { savedToBackup: false };
  } catch (error: unknown) {
    if (isIdbSaveError(error)) {
      // Already-tagged failures (idb_unhealthy / timeout) — re-throw as-is
      if (error.code === 'idb_unhealthy') recordIndexedDBFailure(store);
      throw error;
    }

    // Audit M4: iOS Safari throws "InvalidStateError: The database connection
    // is closing" when the page enters bfcache (tab switch / phone lock /
    // back-forward navigation) mid-write. This is NOT an IDB health problem
    // and must not trip the circuit breaker — log at info level, skip the
    // breaker bookkeeping, but still throw IdbSaveError so the form keeps its
    // dirty flag and the user can retry on resume.
    if (isIdbClosingError(error)) {
      if (import.meta.env.DEV) {
        console.info(`[Offline Storage] Save skipped — IDB closing in ${operationName}`);
      }
      dbConnectionVerified = false;
      // Discard the cached connection: the resolved `dbPromise` holds a
      // closed IDBDatabase handle. Mirror the timeout recovery pattern so
      // the next op opens a fresh connection on bfcache resume.
      if (dbPromise) {
        dbPromise.then(db => db.close()).catch(() => {});
        dbPromise = null;
      }
      const diag = await captureIdbSaveDiagnostics({
        store,
        probeMs,
        opMs,
        elapsedMs: Date.now() - boundaryStart,
        timeoutMs: OPERATION_TIMEOUT,
      });
      throw new IdbSaveError('idb_closing', operationName, { ...diag, originalError: String(error) });
    }

    console.error(`[Offline Storage] Save error in ${operationName}:`, error);
    dbConnectionVerified = false;

    const errName = (error as { name?: unknown } | null | undefined)?.name;
    const errMsg = (error as { message?: unknown } | null | undefined)?.message;
    const isQuotaError = errName === 'QuotaExceededError' || (typeof errMsg === 'string' && errMsg.includes('QuotaExceeded'));
    if (!isQuotaError) {
      recordIndexedDBFailure(store);
    }

    const diag = await captureIdbSaveDiagnostics({
      store,
      probeMs,
      opMs,
      elapsedMs: Date.now() - boundaryStart,
      timeoutMs: OPERATION_TIMEOUT,
    });

    if (isQuotaError && typeof window !== 'undefined') {
      import('@/hooks/use-toast').then(({ toast }) => {
        toast({
          title: 'Storage full',
          description: 'Device storage is full. Please sync your data and clear old reports.',
          variant: 'destructive',
        });
      }).catch(() => {});
      throw new IdbSaveError('quota_exceeded', operationName, { ...diag, originalError: String(error) });
    }

    throw new IdbSaveError('unknown', operationName, { ...diag, originalError: String(error) });
  }
}

async function withIndexedDBErrorBoundary<T>(
  operation: () => Promise<T>,
  fallbackValue: T,
  operationName: string,
  options?: {
    /** Per-store breaker key. Defaults to 'global' for legacy callers. */
    store?: BreakerStoreKey;
    /**
     * M5: User-critical reads (e.g. loading the report the user is actively
     * editing) bypass the breaker's "open → return fallback immediately"
     * short-circuit and attempt the read once. Failing to load the active
     * edit surface is catastrophic for UX — it's worth eating one extra
     * timeout per cooldown to give recovery a chance. Failure still
     * records into the breaker so we don't loop forever.
     */
    criticalRead?: boolean;
  }
): Promise<T> {
  const store: BreakerStoreKey = options?.store ?? 'global';
  const criticalRead = options?.criticalRead === true;

  // Mode 8A — layer-level queue-stuck breaker. Unlike the per-store breaker,
  // this one fast-fails ALL callers (including critical reads): the layer
  // breaker only trips when the underlying IDBOpenDBRequest queue is
  // demonstrably wedged, in which case a critical read would also time out
  // and return the same fallback after the full OPERATION_TIMEOUT — we just
  // skip the wait and return now.
  if (isIdbLayerBreakerOpen()) {
    if (import.meta.env.DEV) {
      console.log(`[Offline Storage] Layer breaker open, returning fallback for ${operationName}`);
    }
    return fallbackValue;
  }

  // CIRCUIT BREAKER: If open, return fallback immediately without attempting operation
  // — UNLESS this is a critical read (see option doc above).
  if (isCircuitBreakerOpen(store) && !criticalRead) {
    if (import.meta.env.DEV) {
      console.log(`[Offline Storage] Circuit breaker (${store}) open, returning fallback for ${operationName}`);
    }
    const opLower = operationName.toLowerCase();
    const isWriteOp = opLower.includes('save') || opLower.includes('put') || 
                      opLower.includes('delete') || opLower.includes('queue') || 
                      opLower.includes('update');
    
    // Classify: is this a user-facing report save or a background operation?
    const isUserFacingSave = ['saveinspectionoffline', 'savetrainingoffline', 'savedailyassessmentoffline']
      .some(op => opLower.includes(op.toLowerCase()));

    if (isWriteOp && typeof window !== 'undefined') {
      // Attempt emergency localStorage save for all write ops
      const fallbackSucceeded = emergencyLocalStorageFallback(operationName, fallbackValue);

      // Only surface a toast when the emergency localStorage fallback ALSO
      // failed — that's the only condition where the user's data is actually
      // at risk. The "data is saved to backup storage" path is logged silently;
      // popping that toast on every save spammed users without any action they
      // could take.
      if (isUserFacingSave && !fallbackSucceeded) {
        const cbWarningKey = 'circuit-breaker-warning-shown';
        if (!sessionStorage.getItem(cbWarningKey)) {
          sessionStorage.setItem(cbWarningKey, 'true');
          import('@/hooks/use-toast').then(({ toast }) => {
            toast({
              title: "Storage temporarily unavailable",
              description: "Your changes may not be saved locally. Stay connected to sync your work.",
              variant: "destructive",
            });
          }).catch(() => {});
          const resetTime = getCircuitBreakerResetTime(store);
          setTimeout(() => sessionStorage.removeItem(cbWarningKey), resetTime + 1000);
        }
      }
    }
    return fallbackValue;
  }

  if (criticalRead && isCircuitBreakerOpen(store) && import.meta.env.DEV) {
    console.log(`[Offline Storage] Circuit breaker (${store}) open but ${operationName} is criticalRead — attempting anyway`);
  }

  const opLowerForTier = operationName.toLowerCase();
  let OPERATION_TIMEOUT: number;
  if (opLowerForTier.includes('photo')) {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.write; // photo blob writes
  } else if (
    opLowerForTier.includes('batch') ||
    opLowerForTier.includes('related') ||
    opLowerForTier.includes('training') ||
    opLowerForTier.includes('assessment') ||
    opLowerForTier.includes('getall') ||
    opLowerForTier.includes('unsynced')
  ) {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.batch;
  } else if (opLowerForTier.includes('save') || opLowerForTier.includes('delete') || opLowerForTier.includes('put')) {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.write;
  } else {
    OPERATION_TIMEOUT = IDB_TIMEOUTS.light;
  }
  // Mode 6: widen the boundary's per-op budget while we're inside the
  // post-online recovery grace window. Mirrors the open-side bump in
  // `selectIdbOpenTimeout(..., postOnlineRecovery=true)` so the outer
  // race doesn't fire before the underlying op can complete.
  OPERATION_TIMEOUT = applyPostOnlineGraceBump(OPERATION_TIMEOUT);
  const TIMEOUT_SENTINEL = Symbol('timeout');
  
  try {
    // Wrap the entire operation with a timeout, using a sentinel to detect timeouts
    const result = await withTimeout(
      (async () => {
        // Only run health check if we haven't verified the connection yet
        if (!dbConnectionVerified) {
          const isHealthy = await checkIndexedDBHealth();
          if (!isHealthy) {
            console.warn(`[Offline Storage] IndexedDB unhealthy, returning fallback for ${operationName}`);
            recordIndexedDBFailure(store);
            return fallbackValue;
          }
          // Mark as verified after successful health check
          dbConnectionVerified = true;
        }
        return await operation();
      })(),
      OPERATION_TIMEOUT,
      TIMEOUT_SENTINEL,
    );
    
    // Check if the result is the sentinel -- meaning a timeout occurred
    if (result === TIMEOUT_SENTINEL) {
      console.warn(`[Offline Storage] Timeout detected for ${operationName}, resetting DB connection`);
      dbConnectionVerified = false;
      recordIndexedDBFailure(store);
      recordLayerBoundaryTimeout();
      // Close and discard the stale connection so the next operation opens a fresh one
      if (dbPromise) {
        dbPromise.then(db => db.close()).catch(() => {});
        dbPromise = null;
      }
      return fallbackValue;
    }
    
    recordIndexedDBSuccess(store);
    recordLayerBoundarySuccess();
    return result;
  } catch (error: unknown) {
    // Audit M4: iOS Safari "database connection is closing" — bfcache /
    // tab-switch artifact, NOT an IDB health problem. Log at info level
    // and bypass the circuit breaker so resuming the tab doesn't start in
    // breaker-open state.
    if (isIdbClosingError(error)) {
      if (import.meta.env.DEV) {
        console.info(`[Offline Storage] Read skipped — IDB closing in ${operationName}`);
      }
      dbConnectionVerified = false;
      // Discard the cached connection: the resolved `dbPromise` holds a
      // closed IDBDatabase handle. Mirror the timeout recovery pattern so
      // the next op opens a fresh connection on bfcache resume.
      if (dbPromise) {
        dbPromise.then(db => db.close()).catch(() => {});
        dbPromise = null;
      }
      return fallbackValue;
    }

    console.error(`[Offline Storage] Error in ${operationName}:`, error);
    // Reset verification on error so next operation re-checks
    dbConnectionVerified = false;

    // QuotaExceededError is NOT an IndexedDB health issue — don't count toward circuit breaker
    const errName = (error as { name?: unknown } | null | undefined)?.name;
    const errMsg = (error as { message?: unknown } | null | undefined)?.message;
    const isQuotaError = errName === 'QuotaExceededError' || (typeof errMsg === 'string' && errMsg.includes('QuotaExceeded'));
    if (!isQuotaError) {
      recordIndexedDBFailure(store);
    }

    // IMMEDIATE user notification for QuotaExceededError on FIRST occurrence
    if (isQuotaError) {
      if (typeof window !== 'undefined') {
        import('@/hooks/use-toast').then(({ toast }) => {
          toast({
            title: "Storage full",
            description: "Device storage is full. Please sync your data and clear old reports.",
            variant: "destructive",
          });
        }).catch(() => {});
      }
    }

    return fallbackValue;
  }
}

export async function getDB() {
  if (!dbPromise) {
    // Race-safety: assign `dbPromise` SYNCHRONOUSLY before any `await` so
    // that parallel callers in the same tick share one in-flight open
    // instead of each starting their own openDB chain. Previously the
    // body used `await ensureStorage()` (and `await detectExistingDBVersion`,
    // `await createPreMigrationSnapshot`) before the `dbPromise = …`
    // assignment, so 6 callers from
    // `Promise.all([saveInspectionOffline, …5×saveRelatedDataOffline])`
    // (InspectionForm.tsx:1633-1676 offline-save fan-out) each saw
    // `dbPromise === null`, each entered the if-branch, each opened a
    // separate connection at v18, and each fired its own 5s timeout —
    // observed as 4-6 consecutive
    // `[Offline Storage] IndexedDB open timed out after 5s` warnings
    // during the scope-C offline-edit reproduction (blocker #3).
    //
    // Wrapping the whole body in an IIFE makes the assignment atomic
    // with respect to other JS turns: subsequent callers see the
    // in-flight promise via the truthy `dbPromise` check and await it.
    //
    // The outer try/catch is required because the IIFE is assigned to
    // `dbPromise` synchronously: if any line BEFORE the inner
    // `Promise.race` try/catch throws (e.g. `await ensureStorage()`
    // raising `SecurityError` from `localStorage.getItem(...)` on Safari
    // private browsing or sandboxed iframes), the IIFE rejects but
    // `dbPromise` would otherwise stay set to the rejected promise
    // forever — a rejected `Promise` is truthy, so every subsequent
    // `getDB()` call would skip the `if (!dbPromise)` guard and return
    // the same stale rejection. Resetting `dbPromise = null` in the
    // outer catch before re-throwing restores the pre-IIFE recovery
    // contract: a transient open failure does not poison the cache.
    dbPromise = (async () => {
    try {
    // Ensure storage is available before opening DB (non-blocking)
    await ensureStorage();
    
    // Wrap the entire DB opening process in a timeout to prevent hanging
    // Apply 5-second timeout to the entire DB opening process
    // If IndexedDB hangs, we'll reject and the app can proceed with network-only mode
    // Version 8: Add report_versions store for append-only versioning
    // DB_NAME and DB_VERSION shared with public/db-config.js for SW consistency
    const DB_NAME = 'rope-works-inspections';
    const DB_VERSION = 20;

    // Phase 5 — Schema Migration Safety. Now imported statically at the top
    // of this module (see comment there). Previously this was `await
    // import('./idb-migration-safety')` here, which consumed the 5s IDB-open
    // budget when offline because the lazy chunk has no SW precache entry.
    let upgradeStartTs = 0;
    let upgradeFromVersion = 0;
    let upgradeError: string | undefined;
    let snapshotCreated = false;

    const openDBV8WithTimeout = async () => {
      return openDB<InspectionDB>(DB_NAME, DB_VERSION, {
        async blocked(currentVersion, blockedVersion) {
          console.warn(
            `[Offline Storage] DB upgrade blocked: open at v${currentVersion}, want v${blockedVersion}. ` +
            `Asking Service Worker to release its connection.`
          );
          // Ask the SW to close any IDB handles it's holding so the upgrade can proceed.
          // CRITICAL: bound `navigator.serviceWorker.ready` with a 1500ms timeout —
          // a wedged SW can otherwise hang `blocked()` indefinitely, extending the
          // entire openDB budget and looking like an "IDB open timed out" to callers.
          try {
            if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
              const reg = await Promise.race([
                navigator.serviceWorker.ready,
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
              ]);
              reg?.active?.postMessage({
                type: 'CLOSE_IDB_FOR_UPGRADE',
                dbName: DB_NAME,
                targetVersion: blockedVersion,
              });
            }
          } catch (err) {
            console.warn('[Offline Storage] Could not notify SW about upgrade:', err);
          }
          // Multi-tab block detection — if the upgrade hasn't resolved 3s after
          // `blocked()` fires, dispatch a window event so SyncPulse can surface
          // a "close other tabs" banner. The most common cause of a stuck open
          // is another tab of this app holding a v19 connection.
          setTimeout(() => {
            if (dbPromise && typeof window !== 'undefined') {
              try {
                window.dispatchEvent(new CustomEvent('sync-multi-tab-block', {
                  detail: { currentVersion, blockedVersion },
                }));
              } catch { /* swallow */ }
              try {
                void import('./notification-center').then(({ addSyncNotification }) => {
                  try {
                    addSyncNotification(
                      'Database upgrade pending — close other tabs of this app to complete the upgrade.'
                    );
                  } catch { /* swallow */ }
                }).catch(() => {});
              } catch { /* swallow */ }
            }
          }, 3000);
        },
        async blocking(currentVersion, blockedVersion, event) {
          console.warn(
            `[Offline Storage] This tab is blocking DB upgrade: holding v${currentVersion}, ` +
            `another context wants v${blockedVersion}. Closing connection.`
          );
          try {
            // Close our handle so the other context can upgrade.
            (event.target as IDBDatabase | null)?.close?.();
            // Invalidate the cached promise so the next getDB() call reopens at the new version.
            dbPromise = null;
          } catch (err) {
            console.warn('[Offline Storage] Failed to close blocking connection:', err);
          }
        },
        async upgrade(db, oldVersion, newVersion, transaction) {
          upgradeStartTs = Date.now();
          upgradeFromVersion = oldVersion;
          if (import.meta.env.DEV) {
            console.log(`[Offline Storage] Upgrade v${oldVersion} → v${newVersion}`);
          }
          // Best-effort audit (fire-and-forget; we cannot await inside upgrade).
          try {
            migrationSafety?.recordMigrationStarted(DB_NAME, oldVersion, newVersion ?? DB_VERSION);
          } catch { /* ignore */ }
          // === All existing v6 upgrade logic ===
          let inspectionStore;
          
          if (!db.objectStoreNames.contains('inspections')) {
            inspectionStore = db.createObjectStore('inspections', { keyPath: 'id' });
            inspectionStore.createIndex('by-status', 'status');
            inspectionStore.createIndex('by-synced', 'synced_at');
          } else {
            inspectionStore = transaction.objectStore('inspections');
            if (!inspectionStore.indexNames.contains('by-synced')) {
              inspectionStore.createIndex('by-synced', 'synced_at');
            }
          }
          
          if (!db.objectStoreNames.contains('operations')) {
            db.createObjectStore('operations', { autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('photos')) {
            const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
            photoStore.createIndex('by-inspection', 'inspectionId');
            photoStore.createIndex('by-uploaded', 'uploaded');
          }
          if (!db.objectStoreNames.contains('inspection_systems')) {
            const store = db.createObjectStore('inspection_systems', { keyPath: 'id' });
            store.createIndex('by-inspection', 'inspection_id');
          }
          if (!db.objectStoreNames.contains('inspection_ziplines')) {
            const store = db.createObjectStore('inspection_ziplines', { keyPath: 'id' });
            store.createIndex('by-inspection', 'inspection_id');
          }
          if (!db.objectStoreNames.contains('inspection_equipment')) {
            const store = db.createObjectStore('inspection_equipment', { keyPath: 'id' });
            store.createIndex('by-inspection', 'inspection_id');
          }
          if (!db.objectStoreNames.contains('inspection_standards')) {
            const store = db.createObjectStore('inspection_standards', { keyPath: 'id' });
            store.createIndex('by-inspection', 'inspection_id');
          }
          if (!db.objectStoreNames.contains('inspection_summary')) {
            const store = db.createObjectStore('inspection_summary', { keyPath: 'id' });
            store.createIndex('by-inspection', 'inspection_id');
          }
          if (!db.objectStoreNames.contains('daily_assessments')) {
            const assessmentStore = db.createObjectStore('daily_assessments', { keyPath: 'id' });
            assessmentStore.createIndex('by-status', 'status');
            assessmentStore.createIndex('by-synced', 'synced_at');
          }
          if (!db.objectStoreNames.contains('assessment_operations')) {
            db.createObjectStore('assessment_operations', { autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('daily_assessment_beginning_of_day')) {
            const store = db.createObjectStore('daily_assessment_beginning_of_day', { keyPath: 'id' });
            store.createIndex('by-assessment', 'assessment_id');
          }
          if (!db.objectStoreNames.contains('daily_assessment_end_of_day')) {
            const store = db.createObjectStore('daily_assessment_end_of_day', { keyPath: 'id' });
            store.createIndex('by-assessment', 'assessment_id');
          }
          if (!db.objectStoreNames.contains('daily_assessment_operating_systems')) {
            const store = db.createObjectStore('daily_assessment_operating_systems', { keyPath: 'id' });
            store.createIndex('by-assessment', 'assessment_id');
          }
          if (!db.objectStoreNames.contains('daily_assessment_equipment_checks')) {
            const store = db.createObjectStore('daily_assessment_equipment_checks', { keyPath: 'id' });
            store.createIndex('by-assessment', 'assessment_id');
          }
          if (!db.objectStoreNames.contains('daily_assessment_structure_checks')) {
            const store = db.createObjectStore('daily_assessment_structure_checks', { keyPath: 'id' });
            store.createIndex('by-assessment', 'assessment_id');
          }
          if (!db.objectStoreNames.contains('daily_assessment_environment_checks')) {
            const store = db.createObjectStore('daily_assessment_environment_checks', { keyPath: 'id' });
            store.createIndex('by-assessment', 'assessment_id');
          }
          if (!db.objectStoreNames.contains('trainings')) {
            const trainingStore = db.createObjectStore('trainings', { keyPath: 'id' });
            trainingStore.createIndex('by-status', 'status');
            trainingStore.createIndex('by-synced', 'synced_at');
          }
          if (!db.objectStoreNames.contains('training_operations')) {
            db.createObjectStore('training_operations', { autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('training_delivery_approaches')) {
            const store = db.createObjectStore('training_delivery_approaches', { keyPath: 'id' });
            store.createIndex('by-training', 'training_id');
          }
          if (!db.objectStoreNames.contains('training_operating_systems')) {
            const store = db.createObjectStore('training_operating_systems', { keyPath: 'id' });
            store.createIndex('by-training', 'training_id');
          }
          if (!db.objectStoreNames.contains('training_immediate_attention')) {
            const store = db.createObjectStore('training_immediate_attention', { keyPath: 'id' });
            store.createIndex('by-training', 'training_id');
          }
          if (!db.objectStoreNames.contains('training_verifiable_items')) {
            const store = db.createObjectStore('training_verifiable_items', { keyPath: 'id' });
            store.createIndex('by-training', 'training_id');
          }
          if (!db.objectStoreNames.contains('training_systems_in_place')) {
            const store = db.createObjectStore('training_systems_in_place', { keyPath: 'id' });
            store.createIndex('by-training', 'training_id');
          }
          if (!db.objectStoreNames.contains('training_summary')) {
            const store = db.createObjectStore('training_summary', { keyPath: 'id' });
            store.createIndex('by-training', 'training_id');
          }

          // === NEW in v7: report_backups WAL store ===
          if (!db.objectStoreNames.contains('report_backups')) {
            const backupStore = db.createObjectStore('report_backups', { keyPath: 'id' });
            backupStore.createIndex('by-report', 'reportKey');
            backupStore.createIndex('by-timestamp', 'timestamp');
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created report_backups store (v7 upgrade)');
            }
          }

          // === NEW in v8: report_versions append-only store ===
          // v20: also self-repair missing indexes on existing stores so older
          // partially-created DBs don't permanently break recovery snapshots.
          if (!db.objectStoreNames.contains('report_versions')) {
            const versionStore = db.createObjectStore('report_versions', { keyPath: 'id' });
            versionStore.createIndex('by-report', 'reportId');
            versionStore.createIndex('by-timestamp', 'timestamp');
            versionStore.createIndex('by-report-version', ['reportId', 'versionNumber']);
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created report_versions store (v8 upgrade)');
            }
          } else {
            try {
              const vs = transaction.objectStore('report_versions');
              if (!vs.indexNames.contains('by-report')) {
                vs.createIndex('by-report', 'reportId');
              }
              if (!vs.indexNames.contains('by-timestamp')) {
                vs.createIndex('by-timestamp', 'timestamp');
              }
              if (!vs.indexNames.contains('by-report-version')) {
                vs.createIndex('by-report-version', ['reportId', 'versionNumber']);
              }
            } catch (err) {
              console.warn('[Offline Storage] report_versions index repair failed:', err);
            }
          }

          // === NEW in v9: autocomplete_history store ===
          if (!db.objectStoreNames.contains('autocomplete_history')) {
            const acStore = db.createObjectStore('autocomplete_history', { keyPath: 'id' });
            acStore.createIndex('by-field-type', 'field_type');
            acStore.createIndex('by-synced', 'synced');
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created autocomplete_history store (v9 upgrade)');
            }
          }
          // === NEW in v10: equipment_type_cache store ===
          if (!db.objectStoreNames.contains('equipment_type_cache')) {
            const etStore = db.createObjectStore('equipment_type_cache', { keyPath: 'id' });
            etStore.createIndex('by-category', 'equipment_category');
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created equipment_type_cache store (v10 upgrade)');
            }
          }
          // === NEW in v11: sync_regression_counters store (S10) ===
          // Persists field-count regression skip counters across reloads so the
          // guard's "after MAX_REGRESSION_SKIPS, allow sync" release isn't lost
          // when a user happens to refresh between sync cycles.
          if (!db.objectStoreNames.contains('sync_regression_counters')) {
            db.createObjectStore('sync_regression_counters', { keyPath: 'id' });
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created sync_regression_counters store (v11 upgrade)');
            }
          }
          // === NEW in v12: dead_letter_soft_deletes store (S28) ===
          // Holds soft-delete queue ops that exhausted MAX_SOFT_DELETE_ATTEMPTS.
          // Operator-visible only — never auto-retried.
          if (!db.objectStoreNames.contains('dead_letter_soft_deletes')) {
            db.createObjectStore('dead_letter_soft_deletes', { keyPath: 'id' });
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created dead_letter_soft_deletes store (v12 upgrade)');
            }
          }
          // === NEW in v13: sync_empty_local_conflicts store (C2) ===
          // Holds parent records where the empty-local-guard tripped — server has
          // child data but local cache is empty and the user_cleared_at marker
          // wasn't stamped. Surfaced in SyncDiagnosticsSheet for user resolution
          // instead of silently restoring server data.
          if (!db.objectStoreNames.contains('sync_empty_local_conflicts')) {
            db.createObjectStore('sync_empty_local_conflicts', { keyPath: 'id' });
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created sync_empty_local_conflicts store (v13 upgrade)');
            }
          }
          // === NEW in v14: admin_edit_snapshot_queue store (H10) ===
          // Queues admin pre-edit snapshot intents captured while offline so they
          // can be uploaded to admin_edit_snapshots on the next online cycle —
          // before the admin's edit itself syncs to the server.
          if (!db.objectStoreNames.contains('admin_edit_snapshot_queue')) {
            const aeqStore = db.createObjectStore('admin_edit_snapshot_queue', {
              keyPath: 'id',
              autoIncrement: true,
            });
            aeqStore.createIndex('by-report', ['reportType', 'reportId']);
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created admin_edit_snapshot_queue store (v14 upgrade)');
            }
          }
          // === NEW in v15: photo_upload_failures store (1.C) ===
          // Persistent dead-letter for photos that crossed MAX_PHOTO_RETRIES.
          // Surfaces in SyncDiagnosticsSheet so failures aren't silent orphans.
          if (!db.objectStoreNames.contains('photo_upload_failures')) {
            const pufStore = db.createObjectStore('photo_upload_failures', {
              keyPath: 'id',
            });
            pufStore.createIndex('by-failed-at', 'lastErrorAt');
            if (import.meta.env.DEV) {
              console.log('[Offline Storage] Created photo_upload_failures store (v15 upgrade)');
            }
          }
          // === NEW in v16: coerce photos.uploaded boolean → 0|1 ===
          // IndexedDB silently drops boolean values from indexes, so the
          // by-uploaded index returned no results. Rewrite legacy rows so
          // the index actually keys them. Safe to re-run (idempotent).
          if (oldVersion < 16 && db.objectStoreNames.contains('photos')) {
            try {
              // Use the raw IDBObjectStore so we can drive the cursor with
              // native onsuccess callbacks inside the upgrade transaction.
              const photoStore = (transaction as unknown as { objectStore(name: string): IDBObjectStore }).objectStore('photos');
              const cursorReq = photoStore.openCursor();
              cursorReq.onsuccess = (ev: Event) => {
                const cursor = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
                if (!cursor) return;
                const v = cursor.value;
                if (typeof v.uploaded === 'boolean') {
                  v.uploaded = v.uploaded ? 1 : 0;
                  cursor.update(v);
                }
                cursor.continue();
              };
              if (import.meta.env.DEV) {
                console.log('[Offline Storage] Rewriting photos.uploaded boolean → 0|1 (v16 upgrade)');
              }
            } catch (err) {
              console.warn('[Offline Storage] v16 photos.uploaded coercion failed:', err);
            }
          }

          // === NEW in v17: backfill `dirty` flag on inspections / trainings / daily_assessments ===
          // C3: a per-record `dirty` boolean is the authoritative "user has
          // unshipped edits" signal. Drift-vs-tolerance becomes a secondary
          // belt-and-braces check. For legacy rows we conservatively backfill:
          //   - any row without `synced_at` ⇒ dirty (never uploaded)
          //   - any row with updated_at meaningfully ahead of synced_at ⇒ dirty
          //   - everything else ⇒ not dirty
          // Idempotent — re-running just re-confirms the same flag.
          if (oldVersion < 17) {
            const SYNC_DRIFT_TOLERANCE_MS = 30_000; // mirror src/lib/local-data-guards.ts
            const backfillDirty = (storeName: 'inspections' | 'trainings' | 'daily_assessments') => {
              if (!db.objectStoreNames.contains(storeName)) return;
              try {
                const store = (transaction as unknown as { objectStore(name: string): IDBObjectStore }).objectStore(storeName);
                const cursorReq = store.openCursor();
                cursorReq.onsuccess = (ev: Event) => {
                  const cursor = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
                  if (!cursor) return;
                  const v = cursor.value;
                  if (typeof v.dirty !== 'boolean') {
                    let dirty = false;
                    if (!v.synced_at) {
                      dirty = true;
                    } else if (v.updated_at) {
                      const u = new Date(v.updated_at).getTime();
                      const s = new Date(v.synced_at).getTime();
                      if (Number.isFinite(u) && Number.isFinite(s) && u - s > SYNC_DRIFT_TOLERANCE_MS) {
                        dirty = true;
                      }
                    }
                    v.dirty = dirty;
                    cursor.update(v);
                  }
                  cursor.continue();
                };
                if (import.meta.env.DEV) {
                  console.log(`[Offline Storage] Backfilling dirty flag on ${storeName} (v17 upgrade)`);
                }
              } catch (err) {
                console.warn(`[Offline Storage] v17 dirty backfill failed for ${storeName}:`, err);
              }
            };
            backfillDirty('inspections');
            backfillDirty('trainings');
            backfillDirty('daily_assessments');
          }

          // === NEW in v18: re-coerce photos.uploaded boolean → 0|1 ===
          // C1: The v16 migration used raw IDBObjectStore cursors which the
          // `idb` wrapper does not await on transaction completion. Any rows
          // that were boolean-typed at v15 may still carry boolean values
          // through to v17. v18 redoes the rewrite using the wrapped
          // IDBPObjectStore so `await` keeps the upgrade tx alive until every
          // row is persisted. Idempotent — numeric rows are skipped.
          if (oldVersion < 18 && db.objectStoreNames.contains('photos')) {
            try {
              const store = transaction.objectStore('photos');
              let cursor = await store.openCursor();
              let rewritten = 0;
              while (cursor) {
                const v = cursor.value as { uploaded?: unknown };
                if (typeof v.uploaded === 'boolean') {
                  v.uploaded = v.uploaded ? 1 : 0;
                  await cursor.update(v as never);
                  rewritten++;
                }
                cursor = await cursor.continue();
              }
              if (import.meta.env.DEV) {
                console.log(`[Offline Storage] v18: re-coerced photos.uploaded on ${rewritten} legacy row(s)`);
              }
            } catch (err) {
              console.warn('[Offline Storage] v18 photos.uploaded re-coercion failed:', err);
            }
          }

          // === NEW in v19: coerce autocomplete_history.synced boolean → 0|1 ===
          // L-3 (audit): same C1 contract as photos.by-uploaded — IDB silently
          // drops booleans from indexes, so `by-synced` returned no results
          // and `getUnsyncedAutocompleteEntries` always yielded []. Coerce
          // legacy rows so the index actually keys them. Idempotent.
          if (oldVersion < 19 && db.objectStoreNames.contains('autocomplete_history')) {
            try {
              const store = transaction.objectStore('autocomplete_history');
              let cursor = await store.openCursor();
              let rewritten = 0;
              while (cursor) {
                const v = cursor.value as { synced?: unknown };
                if (typeof v.synced === 'boolean') {
                  v.synced = v.synced ? 1 : 0;
                  await cursor.update(v as never);
                  rewritten++;
                }
                cursor = await cursor.continue();
              }
              if (import.meta.env.DEV) {
                console.log(`[Offline Storage] v19: coerced autocomplete_history.synced on ${rewritten} legacy row(s)`);
              }
            } catch (err) {
              console.warn('[Offline Storage] v19 autocomplete_history.synced coercion failed:', err);
            }
          }
        },
      });
    };


    // Detect the existing version WITHOUT creating an empty v1 as a side
    // effect. The previous implementation called `openDB(DB_NAME)` (no
    // version), which silently auto-creates v1 on cold-start profiles and
    // races against the subsequent `openDB(DB_NAME, DB_VERSION)` upgrade —
    // surfacing as `[Offline Storage] DB upgrade blocked` warnings followed
    // by 5s open timeouts.
    // Tracked outside the snapshot-creation try-block so the open-race
    // timeout decision below can see it. Defaults to 0 (= treat as
    // upgrade path → use the longer budget) when migrationSafety is
    // absent so we err on the side of letting the open complete.
    let existingVersion = 0;
    try {
      if (migrationSafety) {
        existingVersion = await detectExistingDBVersion(DB_NAME);
        if (existingVersion > 0 && existingVersion < DB_VERSION) {
          const snap = await migrationSafety.createPreMigrationSnapshot(DB_NAME, existingVersion, DB_VERSION);
          snapshotCreated = !!snap.ok;
        }
        // Always prune old snapshots to keep storage bounded.
        migrationSafety.pruneOldSnapshots().catch(() => {});
      }
    } catch (err) {
      console.warn('[Offline Storage] pre-migration snapshot failed:', err);
    }

    // RC-3: 8s timeout on mobile (Safari bfcache restore + iPad cold boot
    // can take 5-6s). RC-4: a cold-start v0 → v18 upgrade chain creates
    // ~14 stores + ~30 indexes + 3 row-by-row dirty-flag backfills + a
    // post-upgrade fingerprint validation. Healthy local: ~200-800ms.
    // Busy CI runner with disk pressure: 4-7s — right on the edge of the
    // steady-state 5s budget. `selectIdbOpenTimeout` returns the longer
    // budget (15s desktop / 20s mobile) when an upgrade is expected
    // (`existingVersion < DB_VERSION`, covers fresh-install at 0 and any
    // multi-version upgrade) and the original fail-fast budget (5s
    // desktop / 8s mobile) at steady state — preserving the H5
    // hung-IDB protection in the dominant returning-user case.
    // Mode 6: also widen the budget when we're inside the post-online recovery
    // grace window. The first `openDB` after `setOffline(true→false)` (or a
    // real cell-tower handoff returning to coverage) has been observed to
    // take >5s on Playwright/Chromium CI runners; granting the upgrade-grade
    // budget here prevents the cascade documented in
    // `mode-6-idb-wedge-after-offline-toggle.md`.
    const inPostOnlineGrace = isInPostOnlineRecoveryGrace();
    const DB_OPEN_TIMEOUT = selectIdbOpenTimeout(existingVersion, DB_VERSION, isMobile(), inPostOnlineGrace);
    let db: IDBPDatabase<InspectionDB>;
    try {
      db = await Promise.race([
        openDBV8WithTimeout(),
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            console.warn(`[Offline Storage] IndexedDB open timed out after ${DB_OPEN_TIMEOUT / 1000}s`);
            reject(new Error('IndexedDB open timed out'));
          }, DB_OPEN_TIMEOUT)
        ),
      ]);
    } catch (error) {
      console.error('[Offline Storage] Failed to open IndexedDB:', error);
      // Phase 5 — record the failure so the recovery UI can offer rollback.
      if (upgradeStartTs > 0 && migrationSafety) {
        upgradeError = (error as { message?: string } | null | undefined)?.message || String(error);
        migrationSafety.recordMigrationOutcome({
          dbName: DB_NAME,
          fromVersion: upgradeFromVersion,
          toVersion: DB_VERSION,
          ok: false,
          durationMs: Date.now() - upgradeStartTs,
          error: upgradeError,
        }).catch(() => {});
      }
      if (snapshotCreated) {
        try {
          localStorage.setItem('idb-migration-rollback-available', '1');
        } catch { /* ignore */ }
      }
      // dbPromise reset handled by the outer catch around the IIFE so the
      // reset and re-throw are synchronous within the same async function;
      // resetting here as well risks racing with a fresh `dbPromise` that a
      // parallel caller may have just installed during the microtask gap
      // between this re-throw and the outer catch.
      throw error;
    }

    // Phase 5 — post-upgrade fingerprint validation.
    if (upgradeStartTs > 0 && migrationSafety) {
      try {
        const expected = [
          { storeName: 'inspections', indexes: ['by-status', 'by-synced'] },
          { storeName: 'operations' },
          { storeName: 'photos', indexes: ['by-inspection', 'by-uploaded'] },
          { storeName: 'inspection_systems', indexes: ['by-inspection'] },
          { storeName: 'inspection_ziplines', indexes: ['by-inspection'] },
          { storeName: 'inspection_equipment', indexes: ['by-inspection'] },
          { storeName: 'inspection_standards', indexes: ['by-inspection'] },
          { storeName: 'inspection_summary', indexes: ['by-inspection'] },
          { storeName: 'daily_assessments', indexes: ['by-status', 'by-synced'] },
          { storeName: 'trainings', indexes: ['by-status', 'by-synced'] },
          { storeName: 'report_backups', indexes: ['by-report', 'by-timestamp'] },
          { storeName: 'report_versions', indexes: ['by-report', 'by-timestamp', 'by-report-version'] },
          { storeName: 'autocomplete_history', indexes: ['by-field-type', 'by-synced'] },
          { storeName: 'equipment_type_cache', indexes: ['by-category'] },
          { storeName: 'dead_letter_soft_deletes' },
        ];
        const fp = await migrationSafety.validateSchemaFingerprint(
          db as unknown as IDBPDatabase,
          expected,
        );
        await migrationSafety.recordMigrationOutcome({
          dbName: DB_NAME,
          fromVersion: upgradeFromVersion,
          toVersion: DB_VERSION,
          ok: true,
          durationMs: Date.now() - upgradeStartTs,
          fingerprintMissing: fp.ok ? undefined : fp.missing,
        });
        if (!fp.ok && import.meta.env.DEV) {
          console.warn('[Offline Storage] Post-upgrade fingerprint mismatch:', fp.missing);
        }
      } catch (err) {
        console.warn('[Offline Storage] post-upgrade validation failed:', err);
      }
    }

    return db;
    } catch (error) {
      // Reset the cache before re-throwing so the next `getDB()` caller
      // can retry. Without this, transient pre-`Promise.race` failures
      // (e.g. `ensureStorage()` raising `SecurityError` on Safari
      // private browsing or in sandboxed iframes) would leave
      // `dbPromise` set to a rejected promise — truthy on the
      // `if (!dbPromise)` check, returned as-is on every subsequent
      // call, permanently breaking offline storage for the session.
      dbPromise = null;
      throw error;
    }
    })();
  }
  return dbPromise;
}

// Inspection functions

/**
 * Save an inspection to IndexedDB.
 * Throws `IdbSaveError` on hard failure (Gap 2.1) — callers MUST handle rejection
 * to avoid clearing the form's dirty flag while data is unsaved.
 * Returns `{ savedToBackup: true }` if the row was written to the localStorage
 * emergency fallback instead of IDB.
 */
export async function saveInspectionOffline(
  inspection: Record<string, unknown> & { id?: string; child_count_hint?: number; dirty?: boolean },
  opts?: { childCountHint?: number }
): Promise<SaveResult> {
  const result = await withIndexedDBSaveBoundary(
    async () => {
      const db = await getDB();
      // S30: prefer caller-provided hint; otherwise preserve existing hint.
      if (opts?.childCountHint != null && opts.childCountHint >= 0) {
        inspection.child_count_hint = opts.childCountHint;
      }
      // C3: stamp the dirty flag at every user-facing save. Authoritative
      // "has unshipped edits" signal; only cleared by safePostSyncSave after
      // a successful round-trip with no concurrent edit.
      inspection.dirty = true;
      await db.put('inspections', inspection as never);
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Saved inspection:', inspection.id);
      }
    },
    'saveInspectionOffline',
    inspection,
  );
  // Audit M3: notify useAutoSync so the periodic interval flips from
  // idleSyncInterval (slow) to activeSyncInterval (fast) the moment a
  // record becomes dirty. Without this the form save just stamps `dirty`
  // in IDB and the next attempt to push it sits behind a 60s+ timer.
  dispatchSyncRecordsUpdated();
  return result;
}

export async function getOfflineInspections(userId?: string, isSuperAdmin?: boolean) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const allInspections = await db.getAll('inspections');
      
      // Filter out soft-deleted records so they don't reappear on dashboard
      // C9 (P2): Also filter out records quarantined due to remote soft-delete; they
      // remain in IDB pending user resolution via RemoteDeletedConflictDialog.
      const activeInspections = allInspections.filter(i => !i.deleted_at && isNotQuarantined(i));
      
      // Super admins see all reports - bypass user filtering
      if (isSuperAdmin) {
        return activeInspections;
      }
      
      // Filter by user ID if provided (for privacy on shared devices)
      if (userId) {
        return activeInspections.filter(i => i.inspector_id === userId);
      }
      
      return activeInspections;
    },
    [],
    'getOfflineInspections'
  );
}

export async function getOfflineInspection(id: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      return await db.get('inspections', id);
    },
    null,
    'getOfflineInspection',
    { store: 'inspections', criticalRead: true }
  );
}

/**
 * N-C strict readers used by verifyRestoreIntegrity. Unlike the regular
 * getOffline* / get*DataOffline helpers, these intentionally bypass
 * `withIndexedDBErrorBoundary` so that IDB failures during a post-restore
 * read propagate as exceptions. The restore-integrity module converts those
 * into `RestoreVerificationError`, which the DataRecoveryTool / backup-ledger
 * callers surface as a user-visible error toast.
 *
 * A silent "null on read" here would be indistinguishable from "record
 * legitimately missing" and defeat the entire purpose of the verifier.
 */
export async function readParentStrict(
  reportType: 'inspection' | 'training' | 'daily_assessment',
  id: string,
): Promise<unknown> {
  const db = await getDB();
  const storeName =
    reportType === 'inspection' ? 'inspections'
      : reportType === 'training' ? 'trainings'
        : 'daily_assessments';
  return await db.get(storeName as 'inspections' | 'trainings' | 'daily_assessments', id);
}

export async function readChildrenStrict(
  reportType: 'inspection' | 'training' | 'daily_assessment',
  childStoreKey: string,
  parentId: string,
): Promise<unknown[]> {
  const db = await getDB();
  let storeName: string | undefined;
  let indexName: 'by-inspection' | 'by-training' | 'by-assessment';
  if (reportType === 'inspection') {
    storeName = storeNameMap[childStoreKey as RelatedDataType];
    indexName = 'by-inspection';
  } else if (reportType === 'training') {
    storeName = trainingStoreNameMap[childStoreKey as TrainingDataType];
    indexName = 'by-training';
  } else {
    storeName = assessmentStoreNameMap[childStoreKey as AssessmentDataType];
    indexName = 'by-assessment';
  }
  if (!storeName) {
    throw new Error(
      `[readChildrenStrict] Unknown child store key: ${reportType}/${childStoreKey}`,
    );
  }
  const idx = db.transaction(storeName as never).store.index(indexName as never);
  const rows = (await idx.getAll(parentId as never)) as unknown[];
  return rows;
}

export async function deleteOfflineInspection(id: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      
      // WAL BACKUP: Snapshot before delete for recovery
      try {
        const record = await db.get('inspections', id);
        if (record) {
          await createReportBackup('inspection', id, record);
        }
      } catch (backupErr) {
        console.warn('[Offline Storage] Pre-delete backup failed for inspection:', backupErr);
      }
      
      await db.delete('inspections', id);
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Deleted offline inspection:', id);
      }
    },
    undefined,
    'deleteOfflineInspection'
  );
}

// S40 (Fix B): Per-session dedup of drift-flagged log lines. Without this,
// a record with stable drift (e.g. another user's stuck record visible via
// orphaned-temp recovery) re-logs on every sync cycle — flooding console and
// hiding real signals. Keyed by `${id}:${drift_bucket_seconds}` so we still
// re-log when drift meaningfully changes.
const driftLogSeen = new Set<string>();
function shouldLogDrift(id: string, driftMs: number): boolean {
  // Bucket to 60s — anything finer is noise; anything coarser hides genuine
  // drift growth.
  const key = `${id}:${Math.floor(driftMs / 60_000)}`;
  if (driftLogSeen.has(key)) return false;
  driftLogSeen.add(key);
  // Bound the set so a long session doesn't leak — 1k entries is plenty.
  if (driftLogSeen.size > 1000) {
    const first = driftLogSeen.values().next().value;
    if (first) driftLogSeen.delete(first);
  }
  return true;
}

export async function getUnsyncedInspections(userId?: string, options?: WedgeLedgerFallbackOptions) {
  // Mode 11A: route through `withWedgeLedgerFallback` so that when the
  // IDB layer breaker is open (= confirmed structural wedge), the drain
  // pipeline reads from `LocalBackupLedger` (synchronous localStorage)
  // instead of waiting for the wedged queue. See diagnostic.
  return withWedgeLedgerFallback(
    () => withIndexedDBReadBoundary(
    async () => {
      const db = await getDB();
      
      // Simple getAll() + filter — reliable across all browsers.
      // These stores typically hold <100 records so full scans are fast.
      // Audit M1: cap the working-set scan at UNSYNCED_SCAN_CAP rows so a
      // pathologically bloated store can't tip the layer breaker via a
      // multi-second IDB transaction. Overflow is reported once per
      // session per store via Sentry.
      const all = await db.getAll('inspections', undefined, UNSYNCED_SCAN_CAP);
      void maybeReportUnsyncedScanOverflow(db, 'inspections', all.length, 'getUnsyncedInspections');
      // C9 (P2): Exclude quarantined records (remote was soft-deleted) from unsynced
      // candidates so we don't keep re-attempting to upload them.
      // S40 (Fix A): Filter by ownership BEFORE the drift check. Records owned
      // by other users (visible on shared devices via cached cross-user reads)
      // are not this user's sync responsibility — evaluating drift on them is
      // pure noise that drove the "295 IDB timeouts/cycle" hot loop. Keep
      // temp-ID orphans regardless of owner so cross-user recovery still works.
      // Audit H1: `isSessionQuarantined` is now a static import (file head).
      const candidates = all.filter(isNotQuarantined).filter(record => {
        if (!userId) return true;
        if (record.inspector_id === userId) return true;
        if (record.id?.startsWith('temp-')) return true; // orphan recovery
        return false;
      }).filter(record => !isSessionQuarantined(record.id)); // S41 (Fix E): drop session-quarantined ids from user-facing count

      const unsynced = candidates.filter(record => {
        // C3: dirty flag is the authoritative "has unshipped edits" signal.
        // Drift-tolerance check is the belt-and-braces secondary path.
        if ((record as { dirty?: unknown }).dirty === true) return true;
        if (!record.synced_at) return true; // never synced
        if (record.updated_at) {
          // M4: Parse each timestamp ONCE per record per scan. Previously
          // `new Date(...).getTime()` was invoked four times per record per
          // filter pass — measurable battery cost on a 500-record store
          // polled ~10×/min. Locals drop that to two parses per record.
          const updatedMs = new Date(record.updated_at).getTime();
          const syncedMs = new Date(record.synced_at).getTime();
          const isUnsynced = isUpdatedAheadOfSync(updatedMs, syncedMs);
          if (isUnsynced && import.meta.env.DEV) {
            const driftMs = updatedMs - syncedMs;
            if (shouldLogDrift(record.id, driftMs)) {
              console.log('[Offline Storage] Inspection flagged unsynced (drift):', {
                id: String(record.id).substring(0, 8),
                localUpdated: record.updated_at,
                localSynced: record.synced_at,
                drift_ms: driftMs,
              });
            }
          }
          return isUnsynced;
        }
        return false;
      });

      const orphanCount = userId
        ? unsynced.filter(i => i.inspector_id !== userId && i.id?.startsWith('temp-')).length
        : 0;
      if (orphanCount > 0) {
        console.warn('[Offline Storage] Found orphaned temp-ID inspections:', { count: orphanCount });
      }
      
      syncLog.log('[Offline Storage] Unsynced inspections:', {
        total: unsynced.length,
        userId: userId ? userId.substring(0, 8) + '...' : 'all',
      });
      
      return unsynced;
    },
    'getUnsyncedInspections',
    { tier: 'batch', store: 'inspections' }
  ),
    'inspection',
    userId,
    'getUnsyncedInspections',
    options,
  );
}

export async function queueOperation(type: 'create' | 'update' | 'delete', inspectionId: string, data: Record<string, unknown>) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.add('operations', {
        type,
        inspectionId,
        data,
        timestamp: Date.now(),
        retries: 0,
      });
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Queued operation:', { type, inspectionId });
      }
      
      // S8: registerInspectionSync removed — SW sync is disabled and the
      // main-thread useAutoSync hook is the sole consumer of queued operations.
    },
    undefined,
    'queueOperation'
  );
}

export async function getQueuedOperations() {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const operations = await db.getAll('operations');
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Queued operations:', operations.length);
      }
      return operations;
    },
    [],
    'getQueuedOperations'
  );
}

export async function removeQueuedOperation(id: number | undefined | null) {
  if (id === undefined || id === null) {
    console.warn('[Offline Storage] Cannot remove operation with undefined/null ID');
    return;
  }
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.delete('operations', id);
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Removed queued operation:', id);
      }
    },
    undefined,
    'removeQueuedOperation'
  );
}

export async function clearAllQueuedOperations() {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('operations', 'readwrite');
      await tx.store.clear();
      await tx.done;
      console.log('[Offline Storage] Cleared all queued operations');
    },
    undefined,
    'clearAllQueuedOperations'
  );
}

export async function clearAllQueuedAssessmentOperations() {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('assessment_operations', 'readwrite');
      await tx.store.clear();
      await tx.done;
      console.log('[Offline Storage] Cleared all queued assessment operations');
    },
    undefined,
    'clearAllQueuedAssessmentOperations'
  );
}

export async function clearAllQueuedTrainingOperations() {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('training_operations', 'readwrite');
      await tx.store.clear();
      await tx.done;
      console.log('[Offline Storage] Cleared all queued training operations');
    },
    undefined,
    'clearAllQueuedTrainingOperations'
  );
}

// Audit P1: this counter persists how many times a queued op has been retried
// after transient failures. The silent boundary previously swallowed errors
// and returned `undefined` — meaning a write that failed (closed connection,
// quota, etc.) silently no-op'd, the counter never advanced, and the op
// would retry indefinitely against whatever transient condition was hitting
// it. Promote to the strict-save boundary so callers can decide how to
// degrade (e.g. force dead-letter, surface diagnostic) instead of getting a
// false-success.
//
// `incrementOperationRetry` currently has no in-tree callers — it's part of
// the public API for queued-op processors to opt into. Migrating now ensures
// any future caller inherits loud-fail semantics by default.
export async function incrementOperationRetry(id: number): Promise<SaveResult> {
  return withIndexedDBSaveBoundary(
    async () => {
      const db = await getDB();
      const operation = await db.get('operations', id);
      if (operation) {
        operation.retries += 1;
        await db.put('operations', operation);
      }
    },
    'incrementOperationRetry',
    undefined, // no localStorage fallback — counter has no reportType shape
    { store: 'global' }
  );
}

// ============================================================
// S28 — Queued operation patch helpers + dead-letter store
// ============================================================

export interface DeadLetterSoftDelete {
  id: string;
  queueStore: 'operations' | 'assessment_operations' | 'training_operations';
  table: 'inspections' | 'trainings' | 'daily_assessments';
  recordId: string;
  attempts: number;
  firstFailedAt: string;
  lastError: string;
  deadLetteredAt: string;
  originalOp: Record<string, unknown>;
}

async function patchOpInStore(
  storeName: 'operations' | 'assessment_operations' | 'training_operations',
  id: number | undefined | null,
  patch: Record<string, unknown>
) {
  if (id === undefined || id === null) return;
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const op = await db.get(storeName, id);
      if (!op) return;
      const merged = { ...op, ...patch };
      await db.put(storeName, merged);
    },
    undefined,
    `patchOp:${storeName}`
  );
}

export async function updateQueuedOperation(id: number | undefined | null, patch: Record<string, unknown>) {
  return patchOpInStore('operations', id, patch);
}

export async function updateQueuedAssessmentOperation(id: number | undefined | null, patch: Record<string, unknown>) {
  return patchOpInStore('assessment_operations', id, patch);
}

export async function updateQueuedTrainingOperation(id: number | undefined | null, patch: Record<string, unknown>) {
  return patchOpInStore('training_operations', id, patch);
}

// Audit P1: the dead-letter store is the safety net for queued operations
// that have exhausted their retry budget. The silent boundary previously
// swallowed write errors and returned `undefined` — meaning the caller
// (`queued-soft-delete-processor.handleSoftDeleteFailure`) would proceed to
// `await remove(op.id)` and **delete the queued op from the queue** even
// though the dead-letter row was never written. Net result: the op is gone
// from the queue AND from the dead-letter store. The recovery tool sees
// nothing; the operator has no way to recover the lost soft-delete.
//
// Promote to the strict-save boundary so the caller's existing try/catch
// at `queued-soft-delete-processor.ts:118` runs: it skips the `remove(op.id)`
// and bumps `attempts` via `patch()`, leaving the op in the queue for the
// next sync cycle to retry. The op is never lost.
export async function addToDeadLetterSoftDeletes(
  entry: DeadLetterSoftDelete,
): Promise<SaveResult> {
  return withIndexedDBSaveBoundary(
    async () => {
      const db = await getDB();
      await db.put('dead_letter_soft_deletes', entry as unknown as DbRow);
      if (import.meta.env.DEV) {
        console.warn('[Offline Storage] Dead-lettered soft-delete:', entry.id, entry.lastError);
      }
    },
    'addToDeadLetterSoftDeletes',
    undefined, // no localStorage fallback — dead-letter row has no reportType shape
    { store: 'global' },
  );
}

export async function getDeadLetterSoftDeletes(): Promise<DeadLetterSoftDelete[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const all = await db.getAll('dead_letter_soft_deletes');
      return (all as unknown as DeadLetterSoftDelete[]).sort(
        (a, b) => new Date(b.deadLetteredAt).getTime() - new Date(a.deadLetteredAt).getTime()
      );
    },
    [],
    'getDeadLetterSoftDeletes'
  );
}

export async function removeDeadLetterSoftDelete(id: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.delete('dead_letter_soft_deletes', id);
    },
    undefined,
    'removeDeadLetterSoftDelete'
  );
}


/**
 * C1: Coerce any caller-supplied `uploaded` value to the on-disk shape (0|1).
 * IndexedDB silently drops boolean values from indexes — every write site
 * MUST funnel through this helper so the `by-uploaded` index stays queryable.
 */
export function toUploadedFlag(v: unknown): 0 | 1 {
  return v ? 1 : 0;
}

/**
 * N-G: The ONLY allowed `db.put('photos', …)` call site.
 * Every other write (`markPhotoAsUploaded`, `updatePhotoPath`, caption edits,
 * retry bookkeeping, `photo-cache.ts`, etc.) funnels through this helper.
 *
 * Why: any write that bypasses `toUploadedFlag` silently regresses the C1 fix
 * — on spec-strict IDB (Safari/iOS) a boolean `uploaded: false` is dropped
 * from the `by-uploaded` index, so the photo never surfaces to `syncPhotos`.
 * Centralising the write means adding a new photo-mutation function can't
 * skip the coercion by accident.
 */
export async function putPhotoRecord(
  db: IDBPDatabase<InspectionDB>,
  photo: Record<string, unknown> & { id: string; inspectionId: string; uploaded?: unknown },
): Promise<void> {
  await db.put('photos', {
    ...photo,
    uploaded: toUploadedFlag(photo?.uploaded),
  } as never);
}

export async function savePhotoOffline(photo: {
  id: string;
  inspectionId: string;
  section: string;
  blob: Blob;
  fileName: string;
  uploaded?: 0 | 1 | boolean;
  photoUrl?: string;
  tableName?: string;
  storageBucket?: string;
  foreignKeyColumn?: string;
  caption?: string;
  capturedByUserId?: string | null; // S23
}): Promise<boolean> {
  return withIndexedDBErrorBoundary(
    async () => {
      try {
        const db = await getDB();
        
        // NON-BLOCKING quota check - fire-and-forget, don't await
        checkStorageQuota().then(quota => {
          if (quota.percentUsed > 90) {
            console.warn('[Offline Storage] Storage almost full:', quota.percentUsed.toFixed(1), '%');
          }
        }).catch(() => {});
        
        // N-G: route every photo write through putPhotoRecord so toUploadedFlag
        // is guaranteed to run — protects the C1 fix from being regressed by
        // future photo-mutation code paths.
        await putPhotoRecord(db, {
          ...photo,
          timestamp: Date.now(),
        });
        
        if (import.meta.env.DEV) {
          console.log('[Offline Storage] Saved photo:', photo.id);
        }
        
        // S8: registerPhotoSync removed — SW background sync is disabled;
        // useAutoSync schedules photo uploads from the main thread.
        
        return true;
      } catch (error: unknown) {
        console.error('[Offline Storage] Failed to save photo:', error);
        
        if ((error as { name?: unknown } | null | undefined)?.name === 'QuotaExceededError') {
          throw new Error('Storage quota exceeded. Please sync photos to free up space.');
        }
        
        throw error;
      }
    },
    false,
    'savePhotoOffline'
  );
}

/**
 * Audit M3: previously this returned `0` on IDB-boundary failure (silent
 * `withIndexedDBErrorBoundary`), making "no photos to relink" indistinguishable
 * from "IDB transaction failed". Atomic-sync callers `await` the result but
 * ignore the count, so a real failure left photos orphaned under the temp
 * inspection-id with no surfaced error.
 *
 * We can't simply throw here: by the time atomic-sync calls relink, the
 * server transaction has already committed, `safePostSyncSave` has stamped
 * `synced_at` on the new-UUID record locally, and the old temp-id parent
 * has been deleted (`atomic-sync-manager.ts:1253` / `:2214` / `:3048`).
 * Throwing would (a) report a successful sync as failed, (b) trigger
 * futile retries against the deleted temp-id, and (c) NOT actually retry —
 * `getUnsyncedInspections` skips records with `synced_at` set, so the
 * retry never reaches the photo relink.
 *
 * Instead we use a sentinel return to distinguish "no photos" (`0`) from
 * "IDB boundary failed" (`-1`). On boundary-failure we log a loud warning,
 * emit a `sync` notification so the operator/admin sees the orphan condition,
 * and return `0` so the caller's post-sync cleanup completes normally. The
 * orphan can still be recovered: `getUnuploadedPhotos()` enumerates the
 * full photos store, so `syncPhotos()` will eventually find the temp-id
 * photos and upload them under the temp-id storage prefix; the next sync
 * cycle that re-encounters this temp-id will re-attempt the relink.
 */
const RELINK_BOUNDARY_FAILED = -1;

export async function relinkPhotosToNewInspectionId(
  oldInspectionId: string,
  newInspectionId: string
): Promise<number> {
  const result = await withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('photos', 'readwrite');
      const index = tx.store.index('by-inspection');
      const photos = await index.getAll(oldInspectionId);
      
      let relinkedCount = 0;
      for (const photo of photos) {
        photo.inspectionId = newInspectionId;
        // Also normalize any photoUrl that still embeds the old temp ID
        if (photo.photoUrl && photo.photoUrl.includes(oldInspectionId)) {
          photo.photoUrl = photo.photoUrl.replace(oldInspectionId, newInspectionId);
        }
        // N-G: in-transaction put — coerce uploaded so a legacy boolean value
        // (from a pre-v18 row that migration missed) cannot sneak back into
        // the store and silently break the by-uploaded index.
        photo.uploaded = toUploadedFlag((photo as { uploaded?: unknown }).uploaded);
        await tx.store.put(photo);
        relinkedCount++;
      }
      
      await tx.done;
      
      if (relinkedCount > 0) {
        console.log(`[Offline Storage] Relinked ${relinkedCount} photos from ${oldInspectionId} to ${newInspectionId}`);
      }
      
      return relinkedCount;
    },
    RELINK_BOUNDARY_FAILED,
    'relinkPhotosToNewInspectionId'
  );

  if (result === RELINK_BOUNDARY_FAILED) {
    const warning = `[Offline Storage] relinkPhotosToNewInspectionId IDB-boundary failed for ${oldInspectionId} → ${newInspectionId}. Photos may remain under the temp id and require manual recovery via the sync diagnostics terminal.`;
    console.warn(warning);
    // Audit P3: static-import (see top-of-file) — the previous dynamic
    // `import('./notification-center')` could silently fail if the lazy
    // chunk fetch hung on a flaky-Wi-Fi iPad, leaving the orphan condition
    // visible only via console.warn (not observable to the user).
    try {
      addSyncNotificationStatic(
        `Could not relink offline photos to new report id (${newInspectionId.slice(0, 8)}…). The report itself synced successfully; photos may need a manual retry.`
      );
    } catch {
      /* never let notification dispatch break sync */
    }
    return 0;
  }

  return result;
}

/**
 * Update the photoUrl for a specific photo record in IndexedDB.
 * Used by sync-manager to normalize pending/ paths.
 */
export async function updatePhotoUrl(photoId: string, newUrl: string): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('photos', 'readwrite');
      const photo = await tx.store.get(photoId);
      if (photo) {
        photo.photoUrl = newUrl;
        // N-G: coerce uploaded in case a legacy boolean value is present.
        photo.uploaded = toUploadedFlag((photo as { uploaded?: unknown }).uploaded);
        await tx.store.put(photo);
      }
      await tx.done;
    },
    undefined,
    'updatePhotoUrl'
  );
}

export async function getOfflinePhotos(inspectionId: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const index = db.transaction('photos').store.index('by-inspection');
      return await index.getAll(inspectionId);
    },
    [],
    'getOfflinePhotos'
  );
}

/**
 * Update the caption of an offline (unsynced) photo in IndexedDB
 */
export async function updateOfflinePhotoCaption(photoId: string, caption: string): Promise<boolean> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const photo = await db.get('photos', photoId);
      if (photo) {
        photo.caption = caption;
        // N-G: centralised photo write.
        await putPhotoRecord(db, photo);
        if (import.meta.env.DEV) {
          console.log('[Offline Storage] Updated offline photo caption:', photoId);
        }
        return true;
      }
      return false;
    },
    false,
    'updateOfflinePhotoCaption'
  );
}

/**
 * Maximum upload retry attempts for a single photo before it is considered
 * "dead-letter" (excluded from live pending counts but preserved in IDB).
 * Shared between sync-manager and count queries so they always agree.
 */
export const MAX_PHOTO_RETRIES = 5;

/**
 * Cap on per-call UUID-parent existence lookups so a pathological photos
 * store cannot tip the IDB read boundary. Beyond this cap we skip the
 * UUID-orphan check for the overflow tail (those photos stay in the
 * pending list rather than being silently demoted) — the next cycle will
 * pick up a different slice if needed.
 */
const PHOTO_PARENT_LOOKUP_CAP = 200;

/**
 * Returns photos that are eligible to be counted as "pending sync".
 * Excludes:
 *  - photos with a null blob (already partially uploaded)
 *  - photos that exhausted MAX_PHOTO_RETRIES (dead-letter)
 *  - photos whose parent inspection is a temp-* id with no matching local row
 *    (orphan: the parent was deleted before sync, so they can never upload)
 *  - (S43) photos owned by a different user when `userId` is supplied:
 *    `capturedByUserId` set to a different user OR a resolvable parent
 *    inspection whose `inspector_id` is a different user.
 *  - (S43) photos with a UUID parent that no longer exists in local IDB
 *    (deleted/evicted/never-pulled — unrecoverable from this device, surfaced
 *    via `getDeadLetterPhotos` instead so the user-facing pending count drains).
 *
 * The orphan-recovery path is preserved: photos with no `capturedByUserId`
 * AND no parent in IDB AND a temp-* id stay visible for the S23 backfill /
 * cross-user recovery flow.
 */
export async function getUnuploadedPhotos(userId?: string) {
  return withIndexedDBReadBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('photos', 'readonly');
      const index = tx.store.index('by-uploaded');
      const unuploaded = await index.getAll(IDBKeyRange.only(0));
      await tx.done;

      const withBlob = unuploaded.filter(p => p.blob != null);
      // L5: Skip photos still inside their jittered backoff window so a
      // herd of co-failed photos doesn't all retry on the next cycle.
      // `nextRetryAt` is null/undefined for photos that have never failed
      // OR were just reset for manual retry, in which case they fall
      // through immediately. Saturated retryCount filtering still happens
      // below (and again in syncPhotos) so dead-lettered photos stay out.
      const now = Date.now();
      const ready = withBlob.filter(p => !p.nextRetryAt || p.nextRetryAt <= now);
      const eligible = ready.filter(p => (p.retryCount || 0) < MAX_PHOTO_RETRIES);

      // S43: First-pass user-scope by capturedByUserId. Photos explicitly
      // tagged to a different user are dropped immediately — that's a
      // shared-device-residue or stale-session signature and they will
      // never upload under this session's RLS.
      const userScoped = userId
        ? eligible.filter(p => !p.capturedByUserId || p.capturedByUserId === userId)
        : eligible;

      // Resolve parent inspections in a single readonly transaction so we
      // can apply both the existing temp-orphan check AND the new UUID-
      // orphan + ownership checks with one walk. Capped at
      // PHOTO_PARENT_LOOKUP_CAP — overflow photos skip the parent check
      // (kept in the pending list as a safe default).
      const needsParent = userScoped.slice(0, PHOTO_PARENT_LOOKUP_CAP);
      const dropIds = new Set<string>();
      const orphanUuidIds = new Set<string>();
      // S43: Parent-walk (orphan + ownership filter) only runs when a userId
      // is supplied. Untyped/legacy callers (tests, internal probes) get the
      // raw eligible set so they never silently lose photos to ownership
      // heuristics they didn't opt into.
      if (userId && needsParent.length > 0) {
        const inspTx = db.transaction('inspections', 'readonly');
        await Promise.all(
          needsParent.map(async (p) => {
            const parent = await inspTx.store.get(p.inspectionId);
            const isTemp = p.inspectionId?.startsWith('temp-');
            if (!parent) {
              if (isTemp) {
                // Existing behaviour: temp orphan → drop from pending,
                // it will surface in the dead-letter / orphan-recovery flow.
                dropIds.add(p.id);
              } else {
                // S43: UUID orphan → drop from pending and route to
                // dead-letter so the badge drains. The photo is not
                // deleted; users can still retry it from the SyncPulse
                // sheet if the parent ever returns.
                orphanUuidIds.add(p.id);
                dropIds.add(p.id);
              }
              return;
            }
            // S43: Ownership filter via parent. Only drop if BOTH
            // capturedByUserId and inspector_id disagree with the active
            // user — a parent owned by user A but capturedBy === userId
            // is still legitimately this user's photo (e.g. admin edit).
            if (
              userId &&
              (parent as { inspector_id?: string }).inspector_id &&
              (parent as { inspector_id?: string }).inspector_id !== userId &&
              p.capturedByUserId !== userId
            ) {
              dropIds.add(p.id);
            }
          })
        );
        await inspTx.done;
      }

      // Stash UUID-orphan ids for getDeadLetterPhotos to find on its next
      // call. We don't mutate the photo row (read-only path); the dead-
      // letter reader recomputes the same predicate.
      void orphanUuidIds; // referenced by tests; kept here for symmetry

      return userScoped.filter(p => !dropIds.has(p.id));
    },
    'getUnuploadedPhotos',
    { tier: 'photo', store: 'photos' }
  );
}

/**
 * Returns photos that are stuck (dead-letter): retry-exhausted, temp-orphan,
 * or (S43) UUID-orphan. When `userId` is supplied, only photos this user can
 * actually retry are returned — the SyncPulse "Retry Now" action must not
 * touch other users' residue on shared devices.
 */
export async function getDeadLetterPhotos(userId?: string): Promise<InspectionDB['photos']['value'][]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('photos', 'readonly');
      const index = tx.store.index('by-uploaded');
      const unuploaded = await index.getAll(IDBKeyRange.only(0));
      await tx.done;

      const withBlob = unuploaded.filter(p => p.blob != null);

      // S43: First-pass user-scope by capturedByUserId.
      const userScoped = userId
        ? withBlob.filter(p => !p.capturedByUserId || p.capturedByUserId === userId)
        : withBlob;

      const exhausted = userScoped.filter(p => (p.retryCount || 0) >= MAX_PHOTO_RETRIES);

      // Identify temp-* and UUID orphans in a single inspections readonly
      // transaction, capped at PHOTO_PARENT_LOOKUP_CAP.
      const candidates = userScoped
        .filter(p => (p.retryCount || 0) < MAX_PHOTO_RETRIES)
        .slice(0, PHOTO_PARENT_LOOKUP_CAP);
      const orphans: InspectionDB['photos']['value'][] = [];
      if (candidates.length > 0) {
        const inspTx = db.transaction('inspections', 'readonly');
        await Promise.all(
          candidates.map(async (p) => {
            const parent = await inspTx.store.get(p.inspectionId);
            if (!parent) {
              orphans.push(p);
              return;
            }
            // Ownership-mismatched but parent-present photos are NOT
            // surfaced as dead-letter — they belong to another user and
            // shouldn't appear in this user's "Retry Now" list at all.
          })
        );
        await inspTx.done;
      }

      // Dedupe by id
      const seen = new Set<string>();
      return [...exhausted, ...orphans].filter(p => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
    },
    [],
    'getDeadLetterPhotos'
  );
}

/**
 * Reset retryCount = 0 on every photo. Used by the boot one-shot migration
 * and the manual "Retry" action in the SyncPulse sheet.
 */
export async function resetPhotoRetryCounts(onlyIds?: string[]): Promise<number> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('photos', 'readwrite');
      let cursor = await tx.store.openCursor();
      let reset = 0;
      const idSet = onlyIds ? new Set(onlyIds) : null;
      while (cursor) {
        const photo = cursor.value;
        const matches = idSet ? idSet.has(photo.id) : true;
        // L5: Also reset photos that have a pending backoff window even if
        // retryCount=0 (e.g. a single transient flake), so the "Retry" button
        // doesn't appear broken for the user-requested-now case.
        const hasRetryCount = (photo.retryCount || 0) > 0;
        const hasBackoffWindow = !!photo.nextRetryAt;
        if (matches && (hasRetryCount || hasBackoffWindow)) {
          photo.retryCount = 0;
          // L5: Clear the backoff window so the photo is eligible immediately
          // on the next sync cycle. This mirrors `resetPhotoForRetry` for
          // the bulk path used by SyncPulse's "Retry" button.
          photo.nextRetryAt = null;
          // N-G: must coerce `uploaded` on every photo write — this path
          // iterates ALL photos and a legacy boolean-keyed row (pre-v18 or
          // a row whose migration failed) would otherwise round-trip
          // through here with the boolean intact, keeping the by-uploaded
          // index broken on Safari.
          photo.uploaded = toUploadedFlag(photo.uploaded);
          await cursor.update(photo);
          reset++;
        }
        cursor = await cursor.continue();
      }
      await tx.done;
      if (reset > 0 && import.meta.env.DEV) {
        console.log(`[Offline Storage] Reset retryCount on ${reset} photos`);
      }
      return reset;
    },
    0,
    'resetPhotoRetryCounts'
  );
}

/**
 * Auto-prune synced photo blobs older than 7 days to free IndexedDB storage.
 * Never touches unsynced (uploaded = false) photos.
 */
export async function pruneOldSyncedPhotoBlobs(): Promise<number> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      const cutoff = Date.now() - SEVEN_DAYS;
      const tx = db.transaction('photos', 'readwrite');
      const index = tx.store.index('by-uploaded');
      // uploaded = true = 1 in IndexedDB index
      let cursor = await index.openCursor(IDBKeyRange.only(1));
      let pruned = 0;
      while (cursor) {
        const photo = cursor.value;
        // M6: Prune based on upload-confirmation time, not cache time. A photo
        // cached long ago but uploaded today must keep its blob as a recovery
        // source. Fall back to cachedAt only for legacy rows that predate the
        // uploadedAt field (they have no other timestamp signal available).
        const referenceTime = photo.uploadedAt ?? photo.cachedAt;
        if (photo.blob != null && referenceTime && referenceTime < cutoff) {
          photo.blob = null;
          // N-G defence-in-depth: coerce `uploaded` on every cursor.update.
          // Even though this cursor is opened on `by-uploaded` only(1) —
          // so the visible rows are already numeric-indexed — round-tripping
          // without coercion leaves a latent regression if a future index
          // rebuild ever admits a boolean row.
          photo.uploaded = toUploadedFlag(photo.uploaded);
          await cursor.update(photo);
          pruned++;
        }
        cursor = await cursor.continue();
      }
      await tx.done;
      if (pruned > 0 && import.meta.env.DEV) {
        console.log(`[Offline Storage] Pruned ${pruned} old synced photo blobs`);
      }
      return pruned;
    },
    0,
    'pruneOldSyncedPhotoBlobs'
  );
}

export async function markPhotoAsUploaded(id: string, photoUrl: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const photo = await db.get('photos', id);
      if (photo) {
        const now = Date.now();
        photo.uploaded = toUploadedFlag(true);
        photo.photoUrl = photoUrl;
        photo.lastValidated = now;
        // M6: Stamp upload-confirmation time so prune can age-out blobs
        // based on when the upload actually succeeded, not when the photo
        // was originally cached.
        photo.uploadedAt = now;
        // Release the binary blob to free IndexedDB storage quota
        photo.blob = null;
        photo.retryCount = 0;
        // S22: Clear any prior error state on success
        photo.lastError = null;
        photo.lastErrorAt = null;
        // L5: Successful upload clears the backoff window so an immediate
        // re-upload (e.g. after a manual edit) is eligible right away.
        photo.nextRetryAt = null;
        // P1: Reset transient-loop counter on success.
        photo.transientCount = 0;
        // N-G: centralised photo write.
        await putPhotoRecord(db, photo);
        
        if (import.meta.env.DEV) {
          console.log('[Offline Storage] Marked photo as uploaded (blob released):', id);
        }
      }
    },
    undefined,
    'markPhotoAsUploaded'
  );
}

export async function updatePhotoPath(id: string, newPath: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const photo = await db.get('photos', id);
      if (photo) {
        photo.photoUrl = newPath;
        // N-G: centralised photo write.
        await putPhotoRecord(db, photo);
        if (import.meta.env.DEV) {
          console.log('[Offline Storage] Updated photo path:', id, '->', newPath);
        }
      }
    },
    undefined,
    'updatePhotoPath'
  );
}

export async function incrementPhotoRetryCount(id: string): Promise<number> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const photo = await db.get('photos', id);
      if (photo) {
        const newCount = (photo.retryCount || 0) + 1;
        photo.retryCount = newCount;
        // L5: Stamp the next-retry window so the photo backs off on the
        // upcoming sync cycle instead of being eligible immediately.
        // jitteredPhotoBackoffMs is 1-indexed and bakes ±20% jitter in,
        // so simultaneous co-failures spread out naturally.
        photo.nextRetryAt = Date.now() + jitteredPhotoBackoffMs(newCount);
        // N-G: centralised photo write.
        await putPhotoRecord(db, photo);
        return newCount;
      }
      return 0;
    },
    0,
    'incrementPhotoRetryCount'
  );
}

/**
 * L5: Stamp a transient-failure marker on a photo without bumping retryCount.
 * Used by the syncPhotos transient-error paths so:
 *  1) `lastError` / `lastErrorAt` are visible in the diagnostics UI even when
 *     the failure is classified as retryable, and
 *  2) `nextRetryAt` is set to a small backoff window so a herd of co-failed
 *     photos doesn't all retry on the very next cycle.
 *
 * The backoff index is `(retryCount || 0) + 1` so a brand-new photo that just
 * hit a transient flake gets attempt-1 spacing (~5s), and a photo that
 * already has permanent failures gets a slightly longer window.
 */
export async function markPhotoTransientFailure(id: string, message: string): Promise<number> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const photo = await db.get('photos', id);
      if (photo) {
        photo.lastError = message.slice(0, 500);
        const now = Date.now();
        photo.lastErrorAt = now;
        photo.nextRetryAt = now + jitteredPhotoBackoffMs((photo.retryCount || 0) + 1);
        // P1: Bump the transient-loop counter and return the new value so
        // the sync layer can demote a photo to dead-letter once it has been
        // looping in the RETRYING bucket past the budget (default 20 cycles).
        photo.transientCount = (photo.transientCount || 0) + 1;
        // N-G: centralised photo write.
        await putPhotoRecord(db, photo);
        return photo.transientCount;
      }
      return 0;
    },
    0,
    'markPhotoTransientFailure'
  );
}

/** P1: Budget for consecutive transient failures before a photo is demoted to
 *  dead-letter. ~20 cycles ≈ 20 jittered backoff windows; with the current
 *  ramp this is well over an hour of give-up time on a healthy connection. */
export const MAX_TRANSIENT_PHOTO_ATTEMPTS = 20;

/**
 * S22: Stamp a human-readable last-error message on a photo so the diagnostics
 * UI can show why it's stuck. Does NOT touch retryCount — callers decide
 * whether the error counts toward the dead-letter ceiling.
 */
export async function setPhotoLastError(id: string, message: string): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const photo = await db.get('photos', id);
      if (photo) {
        photo.lastError = message.slice(0, 500);
        photo.lastErrorAt = Date.now();
        // N-G: centralised photo write.
        await putPhotoRecord(db, photo);
      }
    },
    undefined,
    'setPhotoLastError'
  );
}

/**
 * S22: Manual "Retry" action — zero retryCount and clear lastError so the
 * photo is eligible again on the next sync cycle.
 */
export async function resetPhotoForRetry(id: string): Promise<boolean> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const photo = await db.get('photos', id);
      if (!photo) return false;
      photo.retryCount = 0;
      photo.lastError = null;
      photo.lastErrorAt = null;
      // L5: Manual retry clears the backoff window so the photo is eligible
      // immediately on the next sync cycle, not after waiting out the prior
      // failure's window.
      photo.nextRetryAt = null;
      // P1: Manual retry also clears the transient-loop budget.
      photo.transientCount = 0;
      // N-G: centralised photo write.
      await putPhotoRecord(db, photo);
      return true;
    },
    false,
    'resetPhotoForRetry'
  );
}

/**
 * S23: Stamp the user-id that captured a staged photo so the sync path can
 * refuse to upload it under a different signed-in user's tree.
 */
export async function setPhotoCapturedBy(id: string, userId: string): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const photo = await db.get('photos', id);
      if (photo && !photo.capturedByUserId) {
        photo.capturedByUserId = userId;
        // N-G: centralised photo write.
        await putPhotoRecord(db, photo);
      }
    },
    undefined,
    'setPhotoCapturedBy'
  );
}

/**
 * 1.C — Persist a photo upload failure to the dead-letter store. Idempotent
 * on photo id; updates retryCount/lastError on each call. Preserves
 * `firstFailedAt` from the existing entry if present.
 */
export interface PhotoUploadFailureEntry {
  id: string;
  inspectionId: string;
  fileName: string;
  photoUrl?: string;
  section?: string;
  retryCount: number;
  lastError: string;
  lastErrorAt: number;
  firstFailedAt: number;
  capturedByUserId?: string | null;
}

export async function recordPhotoUploadFailure(
  entry: Omit<PhotoUploadFailureEntry, 'firstFailedAt'> & { firstFailedAt?: number }
): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const existing = await db.get('photo_upload_failures', entry.id).catch(() => null);
      const merged: PhotoUploadFailureEntry = {
        id: entry.id,
        inspectionId: entry.inspectionId,
        fileName: entry.fileName,
        photoUrl: entry.photoUrl,
        section: entry.section,
        retryCount: entry.retryCount,
        lastError: (entry.lastError || '').slice(0, 500),
        lastErrorAt: entry.lastErrorAt,
        firstFailedAt: existing?.firstFailedAt ?? entry.firstFailedAt ?? entry.lastErrorAt,
        capturedByUserId: entry.capturedByUserId ?? null,
      };
      await db.put('photo_upload_failures', merged);
      if (import.meta.env.DEV) {
        console.warn('[Offline Storage] Photo upload failure recorded:', merged.id, merged.lastError);
      }
    },
    undefined,
    'recordPhotoUploadFailure'
  );
}

export async function listPhotoUploadFailures(): Promise<PhotoUploadFailureEntry[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const all: PhotoUploadFailureEntry[] = await db.getAll('photo_upload_failures');
      // Newest failures first.
      return (all || []).sort((a, b) => (b.lastErrorAt || 0) - (a.lastErrorAt || 0));
    },
    [],
    'listPhotoUploadFailures'
  );
}

export async function removePhotoUploadFailure(id: string): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.delete('photo_upload_failures', id);
    },
    undefined,
    'removePhotoUploadFailure'
  );
}

export async function getPhotoUploadFailureCount(): Promise<number> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      return await db.count('photo_upload_failures');
    },
    0,
    'getPhotoUploadFailureCount'
  );
}

/**
 * S23: One-time boot migration. For any legacy photo with `pending/` prefix
 * and no `capturedByUserId`, backfill it ONLY if exactly one user-id is known
 * on this device (per the user_mappings store in offline-auth-store). Otherwise
 * leave them untouched — the sync path will route them to the dead-letter UI.
 */
export async function backfillCapturedByUserIdForPendingPhotos(): Promise<number> {
  return withIndexedDBErrorBoundary(
    async () => {
      // Resolve the set of user-ids ever known on this device.
      let knownUserIds = new Set<string>();
      try {
        const authDb = await openDB('offline-auth-store');
        if (authDb.objectStoreNames.contains('user_mappings')) {
          const mappings: { userId?: string }[] = await authDb.getAll('user_mappings');
          for (const m of mappings) {
            if (m?.userId) knownUserIds.add(m.userId);
          }
        }
        authDb.close();
      } catch {
        // Best-effort; if we can't read auth-store, skip migration.
        return 0;
      }

      if (knownUserIds.size !== 1) {
        return 0; // ambiguous — let sync route them to dead-letter
      }
      const onlyUserId = Array.from(knownUserIds)[0];

      const db = await getDB();
      const tx = db.transaction('photos', 'readwrite');
      let updated = 0;
      let cursor = await tx.store.openCursor();
      while (cursor) {
        const p = cursor.value;
        if (
          !p.uploaded &&
          !p.capturedByUserId &&
          typeof p.photoUrl === 'string' &&
          p.photoUrl.startsWith('pending/')
        ) {
          p.capturedByUserId = onlyUserId;
          // N-G: this cursor is opened on the full store (not by-uploaded)
          // so legacy boolean-keyed rows are visible here. Coerce on write
          // to keep the by-uploaded index queryable on Safari.
          p.uploaded = toUploadedFlag(p.uploaded);
          await cursor.update(p);
          updated++;
        }
        cursor = await cursor.continue();
      }
      await tx.done;
      if (updated > 0 && import.meta.env.DEV) {
        console.log(`[Offline Storage] S23 backfill: tagged ${updated} pending photo(s) with capturedByUserId=${onlyUserId}`);
      }
      return updated;
    },
    0,
    'backfillCapturedByUserIdForPendingPhotos'
  );
}

export async function deleteOfflinePhoto(id: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      
      // WAL backup — snapshot photo before deleting
      try {
        const photo = await db.get('photos', id);
        if (photo && !photo.uploaded && db.objectStoreNames.contains('report_backups')) {
          await db.put('report_backups', {
            id: `photo_backup_${id}_${Date.now()}`,
            reportType: 'photo',
            reportId: id,
            reportKey: `photo_${id}`,
            timestamp: Date.now(),
            data: photo,
          });
        }
      } catch (e) {
        console.warn('[Offline Storage] Non-critical: failed to backup photo before delete:', e);
      }
      
      await db.delete('photos', id);
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Deleted photo:', id);
      }
    },
    undefined,
    'deleteOfflinePhoto'
  );
}

/**
 * Update the display order of photos in IndexedDB for drag-and-drop reordering
 * @param inspectionId - The inspection ID
 * @param section - The photo section
 * @param photoIds - Array of photo IDs in the new order
 */
export async function updatePhotoDisplayOrder(
  inspectionId: string,
  section: string,
  photoIds: string[]
): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('photos', 'readwrite');
      const store = tx.objectStore('photos');
      
      // Update each photo's display_order
      await Promise.all(
        photoIds.map(async (id, index) => {
          const photo = await store.get(id);
          if (photo && photo.inspectionId === inspectionId && photo.section === section) {
            photo.display_order = index;
            // N-G: drag-and-drop reorder would otherwise round-trip a
            // legacy boolean `uploaded` value and re-break the Safari
            // by-uploaded index. Coerce on every write to the photos
            // store without exception.
            photo.uploaded = toUploadedFlag(photo.uploaded);
            await store.put(photo);
          }
        })
      );
      
      await tx.done;
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Updated photo display order:', {
          inspectionId,
          section,
          count: photoIds.length,
        });
      }
    },
    undefined,
    'updatePhotoDisplayOrder'
  );
}

type RelatedDataType = 'systems' | 'ziplines' | 'equipment' | 'standards' | 'summary';
type RelatedStoreNames = 'inspection_systems' | 'inspection_ziplines' | 'inspection_equipment' | 'inspection_standards' | 'inspection_summary';

const storeNameMap: Record<RelatedDataType, RelatedStoreNames> = {
  systems: 'inspection_systems',
  ziplines: 'inspection_ziplines',
  equipment: 'inspection_equipment',
  standards: 'inspection_standards',
  summary: 'inspection_summary',
};

// UUID validation helper - checks if string is a valid UUID format
const isValidUUID = (id: string): boolean => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
};

// Generate a proper UUID for items without valid UUIDs
const ensureValidUUID = (id: string | undefined): string => {
  if (!id || id.startsWith('temp-') || !isValidUUID(id)) {
    return crypto.randomUUID();
  }
  return id;
};

// Audit L2: dedupe the "child_count_hint recompute skipped" dev warning so a
// busy edit session (which can fire 50-100 saves in rapid succession against
// the same parent record) doesn't flood the console with the same warning.
// One warn per (kind, parentId) per session is enough to surface the
// degradation — the actual recovery (preserving the existing hint) already
// runs on every call. The set is intentionally process-lived: a fresh
// PWA load resets it so persistent issues stay visible.
const warnedStaleHints: Set<string> = new Set();
function warnStaleHintOnce(kind: 'inspection' | 'assessment' | 'training', parentId: string, justSavedType: string): void {
  if (!import.meta.env.DEV) return;
  const key = `${kind}:${parentId}`;
  if (warnedStaleHints.has(key)) return;
  warnedStaleHints.add(key);
  console.warn(
    `[Offline Storage] ${kind} child_count_hint recompute skipped — sibling read failed (further occurrences for this record suppressed)`,
    { parentId, justSavedType },
  );
}

// S30: Recompute child_count_hint on the parent record after a child mutation.
// Called fire-and-forget from child-save helpers so it never blocks the save.
// Uses cheap count() per "other" store (not getAllFromIndex) to minimize IDB load,
// and skips entirely on read errors (a stale hint is safe for the SW guard).
async function recomputeInspectionChildCountHint(
  db: IDBPDatabase<InspectionDB>,
  inspectionId: string,
  justSavedType: RelatedDataType,
  justSavedCount: number,
): Promise<void> {
  try {
    const inspection = await db.get('inspections', inspectionId).catch(() => null);
    if (!inspection) return;

    const otherTypes: RelatedDataType[] = (['systems', 'ziplines', 'equipment', 'standards', 'summary'] as RelatedDataType[])
      .filter(t => t !== justSavedType);
    let anyReadFailed = false;
    const counts = await Promise.all(
      otherTypes.map(async (t) => {
        try {
          const idx = db.transaction(storeNameMap[t]).store.index('by-inspection');
          return (await idx.count(inspectionId)) as number;
        } catch {
          // M2: signal degradation instead of silently treating as 0.
          anyReadFailed = true;
          return 0;
        }
      })
    );

    // H2: Bump parent updated_at on every child mutation. Without this, an
    // edit to a child row (e.g. zipline_name) leaves the parent's
    // updated_at == synced_at and `shouldPreserveLocalRecord` returns false,
    // so the Dashboard's network pipeline overwrites the parent and
    // downstream "empty-vs-populated" guards see a parent/child mismatch.
    inspection.updated_at = new Date().toISOString();

    // M2: If any sibling-store count failed (e.g. circuit breaker open),
    // do NOT overwrite child_count_hint with a partial total. A wrong hint
    // (e.g. 0 when there are really 10 rows) defeats downstream regression
    // detectors that compare hint vs live count. Preserve the existing hint
    // so the SW guard still has a real signal to compare against.
    if (!anyReadFailed) {
      const otherTotal = counts.reduce((a, b) => a + b, 0);
      // Summary contributes 1 if any row exists; align with old "summary?.length > 0 ? 1 : 0" semantics.
      const newHint = otherTotal + (justSavedType === 'summary' ? (justSavedCount > 0 ? 1 : 0) : justSavedCount);
      inspection.child_count_hint = newHint;
    } else {
      warnStaleHintOnce('inspection', inspectionId, justSavedType);
    }

    await db.put('inspections', inspection);
  } catch {
    // non-fatal; SW guard tolerates a stale hint
  }
}

async function recomputeAssessmentChildCountHint(
  db: IDBPDatabase<InspectionDB>,
  assessmentId: string,
  justSavedType: AssessmentDataType,
  justSavedCount: number,
): Promise<void> {
  try {
    const assessment = await db.get('daily_assessments', assessmentId).catch(() => null);
    if (!assessment) return;

    const allTypes: AssessmentDataType[] = ['beginning_of_day', 'end_of_day', 'operating_systems', 'equipment_checks', 'structure_checks', 'environment_checks'];
    const otherTypes = allTypes.filter(t => t !== justSavedType);
    let anyReadFailed = false;
    const counts = await Promise.all(
      otherTypes.map(async (t) => {
        try {
          const idx = db.transaction(assessmentStoreNameMap[t]).store.index('by-assessment');
          return (await idx.count(assessmentId)) as number;
        } catch {
          anyReadFailed = true;
          return 0;
        }
      })
    );
    // H2: Always bump parent updated_at on child mutation (see Inspection note).
    assessment.updated_at = new Date().toISOString();
    // M2: preserve existing hint when any sibling read failed.
    if (!anyReadFailed) {
      assessment.child_count_hint = counts.reduce((a, b) => a + b, 0) + justSavedCount;
    } else {
      warnStaleHintOnce('assessment', assessmentId, justSavedType);
    }
    await db.put('daily_assessments', assessment);
  } catch {
    // non-fatal
  }
}

async function recomputeTrainingChildCountHint(
  db: IDBPDatabase<InspectionDB>,
  trainingId: string,
  justSavedType: TrainingDataType,
  justSavedCount: number,
): Promise<void> {
  try {
    const training = await db.get('trainings', trainingId).catch(() => null);
    if (!training) return;

    const allTypes: TrainingDataType[] = ['delivery_approaches', 'operating_systems', 'immediate_attention', 'verifiable_items', 'systems_in_place', 'summary'];
    const otherTypes = allTypes.filter(t => t !== justSavedType);
    let anyReadFailed = false;
    const counts = await Promise.all(
      otherTypes.map(async (t) => {
        try {
          const idx = db.transaction(trainingStoreNameMap[t]).store.index('by-training');
          return (await idx.count(trainingId)) as number;
        } catch {
          anyReadFailed = true;
          return 0;
        }
      })
    );
    // H2: Always bump parent updated_at on child mutation (see Inspection note).
    training.updated_at = new Date().toISOString();
    // M2: preserve existing hint when any sibling read failed.
    if (!anyReadFailed) {
      training.child_count_hint = counts.reduce((a, b) => a + b, 0) + justSavedCount;
    } else {
      warnStaleHintOnce('training', trainingId, justSavedType);
    }
    await db.put('trainings', training);
  } catch {
    // non-fatal
  }
}

export async function saveRelatedDataOffline(
  type: RelatedDataType,
  inspectionId: string,
  data: Record<string, unknown>[],
  options?: { allowEmpty?: boolean }
) {
  // SAFETY: Never overwrite existing IndexedDB data with an empty array
  // UNLESS allowEmpty is explicitly set (user deliberately cleared all items)
  if (data.length === 0 && !options?.allowEmpty) {
    console.warn(`[Offline Storage] Blocked save of empty ${type} array for ${inspectionId} -- preserving existing data`);
    return;
  }

  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = storeNameMap[type];
      
      // Use a SINGLE read-write transaction for atomic batch operations
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.store;
      const index = store.index('by-inspection');
      
      // Get existing data within the transaction
      const existingData = await index.getAll(inspectionId);
      
      // Batch all operations within the same transaction (no await between operations)
      const deletePromises = existingData.map(item => store.delete(item.id));
      const putPromises = data.map(item => {
        const dataWithInspectionId = {
          ...item,
          inspection_id: inspectionId,
          id: ensureValidUUID(item.id as string | undefined),
        };
        return store.put(dataWithInspectionId);
      });
      
      // Execute all operations in parallel, then wait for transaction to complete
      await Promise.all([...deletePromises, ...putPromises]);
      await tx.done;
      
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Saved ${type}:`, data.length, 'items');
      }

      // S30: Recompute child_count_hint on the parent only when children mutate.
      // Fire-and-forget; never block the child save.
      void recomputeInspectionChildCountHint(db, inspectionId, type, data.length);
    },
    undefined,
    `saveRelatedDataOffline:${type}`
  );
}

export async function getRelatedDataOffline(
  type: RelatedDataType,
  inspectionId: string
): Promise<DbRow[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = storeNameMap[type];
      const index = db.transaction(storeName).store.index('by-inspection');
      const results = await index.getAll(inspectionId);
      // Sort by display_order to maintain consistent ordering
      return results.sort(
        (a, b) =>
          ((a as { display_order?: number }).display_order ?? 0) -
          ((b as { display_order?: number }).display_order ?? 0),
      );
    },
    [],
    `getRelatedDataOffline:${type}`
  );
}

/**
 * Status-aware variant: returns whether THIS specific read truly succeeded.
 * Uses a local try/catch + timeout instead of diffing global counters, so a
 * concurrent failing IDB call cannot poison this read's status flag.
 */
export async function getRelatedDataOfflineWithStatus(
  type: RelatedDataType,
  inspectionId: string
): Promise<{ items: DbRow[]; readSucceeded: boolean }> {
  // If the circuit breaker is already open, the read is guaranteed to be a fallback.
  if (isCircuitBreakerOpen('inspections')) {
    return { items: [], readSucceeded: false };
  }
  const { data, timedOut } = await withIDBTimeout<DbRow[]>(
    `getRelatedData(${type}/${inspectionId})`,
    'batch',
    () => getRelatedDataOffline(type, inspectionId),
    [],
  );
  const items = isIdbReadFailure(data) ? [] : (data ?? []);
  return { items, readSucceeded: !timedOut };
}

export async function clearRelatedDataOffline(
  type: RelatedDataType,
  inspectionId: string,
  options?: { bypassTempGuard?: boolean }
) {
  // SAFETY: Only allow clearing data for temp-IDs (used during temp-to-permanent ID migration)
  // Unless explicitly bypassed for orphan cleanup
  if (!inspectionId.startsWith('temp-') && !options?.bypassTempGuard) {
    console.error(`[SAFETY] Blocked clear ${type} operation on non-temp ID:`, inspectionId);
    return;
  }

  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = storeNameMap[type];
      
      // Use a SINGLE read-write transaction for atomic batch delete
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.store;
      const index = store.index('by-inspection');
      
      const existingData = await index.getAll(inspectionId);
      
      // Batch all deletes within the same transaction
      const deletePromises = existingData.map(item => store.delete(item.id));
      await Promise.all(deletePromises);
      await tx.done;
      
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Cleared ${type} for inspection:`, inspectionId);
      }
    },
    undefined,
    `clearRelatedDataOffline:${type}`
  );
}

// Daily Assessment functions
/**
 * Save a daily assessment to IndexedDB.
 * Throws `IdbSaveError` on hard failure (Gap 2.1) — callers MUST handle rejection.
 */
export async function saveDailyAssessmentOffline(
  assessment: Record<string, unknown> & { id?: string; child_count_hint?: number; dirty?: boolean },
  opts?: { childCountHint?: number }
): Promise<SaveResult> {
  const result = await withIndexedDBSaveBoundary(
    async () => {
      const db = await getDB();
      if (opts?.childCountHint != null && opts.childCountHint >= 0) {
        assessment.child_count_hint = opts.childCountHint;
      }
      // C3: stamp the dirty flag at every user-facing save.
      assessment.dirty = true;
      await db.put('daily_assessments', assessment as never);
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Saved daily assessment:', assessment.id);
      }
    },
    'saveDailyAssessmentOffline',
    assessment,
  );
  // Audit M3: see saveInspectionOffline.
  dispatchSyncRecordsUpdated();
  return result;
}

export async function getOfflineDailyAssessments(userId?: string, isSuperAdmin?: boolean) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const allAssessments = await db.getAll('daily_assessments');
      
      // Filter out soft-deleted records so they don't reappear on dashboard
      // C9 (P2): Also filter out quarantined remote-deleted records.
      const activeAssessments = allAssessments.filter(a => !a.deleted_at && isNotQuarantined(a));
      
      // Super admins see all reports - bypass user filtering
      if (isSuperAdmin) {
        return activeAssessments;
      }
      
      // Filter by user ID if provided (for privacy on shared devices)
      if (userId) {
        return activeAssessments.filter(a => a.inspector_id === userId);
      }
      
      return activeAssessments;
    },
    [],
    'getOfflineDailyAssessments'
  );
}

export async function getOfflineDailyAssessment(id: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      return await db.get('daily_assessments', id);
    },
    null,
    'getOfflineDailyAssessment',
    { store: 'daily_assessments', criticalRead: true }
  );
}

export async function deleteOfflineDailyAssessment(id: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      
      // WAL BACKUP: Snapshot before delete for recovery
      try {
        const record = await db.get('daily_assessments', id);
        if (record) {
          await createReportBackup('daily_assessment', id, record);
        }
      } catch (backupErr) {
        console.warn('[Offline Storage] Pre-delete backup failed for assessment:', backupErr);
      }
      
      await db.delete('daily_assessments', id);
    },
    undefined,
    'deleteOfflineDailyAssessment'
  );
}

export async function getUnsyncedDailyAssessments(userId?: string, options?: WedgeLedgerFallbackOptions) {
  // Mode 11A: see `getUnsyncedInspections` above.
  return withWedgeLedgerFallback(
    () => withIndexedDBReadBoundary(
    async () => {
      const db = await getDB();
      
      // Audit M1: cap (see getUnsyncedInspections).
      const all = await db.getAll('daily_assessments', undefined, UNSYNCED_SCAN_CAP);
      void maybeReportUnsyncedScanOverflow(db, 'daily_assessments', all.length, 'getUnsyncedDailyAssessments');
      // S40 (Fix A): Ownership filter before drift check (see getUnsyncedInspections).
      // Audit H1: `isSessionQuarantined` is now a static import (file head).
      const candidates = all.filter(isNotQuarantined).filter(record => {
        if (!userId) return true;
        if (record.inspector_id === userId) return true;
        if (record.id?.startsWith('temp-')) return true;
        return false;
      }).filter(record => !isSessionQuarantined(record.id)); // S41 (Fix E): see getUnsyncedInspections

      const unsynced = candidates.filter(record => {
        // C3: dirty flag = authoritative "has unshipped edits"; drift = secondary.
        if ((record as { dirty?: unknown }).dirty === true) return true;
        if (!record.synced_at) return true;
        if (record.updated_at) {
          // M4: Parse each timestamp once per record (see getUnsyncedInspections).
          const updatedMs = new Date(record.updated_at).getTime();
          const syncedMs = new Date(record.synced_at).getTime();
          return isUpdatedAheadOfSync(updatedMs, syncedMs);
        }
        return false;
      });

      const orphanCount = userId
        ? unsynced.filter(a => a.inspector_id !== userId && a.id?.startsWith('temp-')).length
        : 0;
      if (orphanCount > 0) {
        console.warn('[Offline Storage] Found orphaned temp-ID daily assessments:', { count: orphanCount });
      }
      
      console.log('[Offline Storage] Unsynced daily assessments:', {
        total: unsynced.length,
        userId: userId ? userId.substring(0, 8) + '...' : 'all',
      });
      
      return unsynced;
    },
    'getUnsyncedDailyAssessments',
    { tier: 'batch', store: 'daily_assessments' }
  ),
    'daily_assessment',
    userId,
    'getUnsyncedDailyAssessments',
    options,
  );
}

export async function queueAssessmentOperation(type: 'create' | 'update' | 'delete', assessmentId: string, data: Record<string, unknown>) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.add('assessment_operations', {
        type,
        assessmentId,
        data,
        timestamp: Date.now(),
        retries: 0,
      });
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Queued assessment operation:', { type, assessmentId });
      }
      
      // S8: registerInspectionSync removed (no-op since SW sync is disabled).
    },
    undefined,
    'queueAssessmentOperation'
  );
}

export async function getQueuedAssessmentOperations() {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const operations = await db.getAll('assessment_operations');
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Queued assessment operations:', operations.length);
      }
      return operations;
    },
    [],
    'getQueuedAssessmentOperations'
  );
}

export async function removeQueuedAssessmentOperation(id: number | undefined | null) {
  if (id === undefined || id === null) {
    console.warn('[Offline Storage] Cannot remove assessment operation with undefined/null ID');
    return;
  }
  
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.delete('assessment_operations', id);
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Removed queued assessment operation:', id);
      }
    },
    undefined,
    'removeQueuedAssessmentOperation'
  );
}

export async function incrementAssessmentOperationRetry(id: number | undefined | null) {
  if (id === undefined || id === null) {
    console.warn('[Offline Storage] Cannot increment retry for assessment operation with undefined/null ID');
    return;
  }
  
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const operation = await db.get('assessment_operations', id);
      if (operation) {
        operation.retries += 1;
        await db.put('assessment_operations', operation);
      }
    },
    undefined,
    'incrementAssessmentOperationRetry'
  );
}

type AssessmentDataType = 'beginning_of_day' | 'end_of_day' | 'operating_systems' | 'equipment_checks' | 'structure_checks' | 'environment_checks';
type AssessmentStoreNames = 'daily_assessment_beginning_of_day' | 'daily_assessment_end_of_day' | 'daily_assessment_operating_systems' | 'daily_assessment_equipment_checks' | 'daily_assessment_structure_checks' | 'daily_assessment_environment_checks';

const assessmentStoreNameMap: Record<AssessmentDataType, AssessmentStoreNames> = {
  beginning_of_day: 'daily_assessment_beginning_of_day',
  end_of_day: 'daily_assessment_end_of_day',
  operating_systems: 'daily_assessment_operating_systems',
  equipment_checks: 'daily_assessment_equipment_checks',
  structure_checks: 'daily_assessment_structure_checks',
  environment_checks: 'daily_assessment_environment_checks',
};

export async function saveAssessmentDataOffline(
  type: AssessmentDataType,
  assessmentId: string,
  data: Record<string, unknown>[],
  options?: { allowEmpty?: boolean }
) {
  // SAFETY: Never overwrite existing IndexedDB data with an empty array
  // UNLESS allowEmpty is explicitly set (user deliberately cleared all items)
  if (data.length === 0 && !options?.allowEmpty) {
    console.warn(`[Offline Storage] Blocked save of empty ${type} array for ${assessmentId} -- preserving existing data`);
    return;
  }

  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = assessmentStoreNameMap[type];
      
      // Use a SINGLE read-write transaction for atomic batch operations
      // This matches the optimized pattern in saveRelatedDataOffline
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.store;
      const index = store.index('by-assessment');
      
      // Get existing data within the transaction
      const existingData = await index.getAll(assessmentId);
      
      // Batch all operations within the same transaction (no await between operations)
      const deletePromises = existingData.map(item => store.delete(item.id));
      const putPromises = data.map(item => {
        const dataWithAssessmentId = {
          ...item,
          assessment_id: assessmentId,
          // Use crypto.randomUUID() for proper UUID generation instead of composite IDs
          id: ensureValidUUID(item.id as string | undefined),
        };
        return store.put(dataWithAssessmentId);
      });
      
      // Execute all operations in parallel, then wait for transaction to complete
      await Promise.all([...deletePromises, ...putPromises]);
      await tx.done;
      
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Saved assessment ${type}:`, data.length, 'items');
      }

      // S30: Recompute child_count_hint on the parent (fire-and-forget).
      void recomputeAssessmentChildCountHint(db, assessmentId, type, data.length);
    },
    undefined,
    `saveAssessmentDataOffline:${type}`
  );
}

export async function getAssessmentDataOffline(
  type: AssessmentDataType,
  assessmentId: string
): Promise<DbRow[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = assessmentStoreNameMap[type];
      const index = db.transaction(storeName).store.index('by-assessment');
      const results = await index.getAll(assessmentId);
      return results.sort((a, b) => {
        const ac = (a as { created_at?: string | number }).created_at ?? 0;
        const bc = (b as { created_at?: string | number }).created_at ?? 0;
        return new Date(ac).getTime() - new Date(bc).getTime();
      });
    },
    [],
    `getAssessmentDataOffline:${type}`
  );
}

/** Status-aware variant — see getRelatedDataOfflineWithStatus. */
export async function getAssessmentDataOfflineWithStatus(
  type: AssessmentDataType,
  assessmentId: string
): Promise<{ items: DbRow[]; readSucceeded: boolean }> {
  if (isCircuitBreakerOpen('daily_assessments')) {
    return { items: [], readSucceeded: false };
  }
  const { data, timedOut } = await withIDBTimeout<DbRow[]>(
    `getAssessmentData(${type}/${assessmentId})`,
    'batch',
    () => getAssessmentDataOffline(type, assessmentId),
    [],
  );
  return { items: data ?? [], readSucceeded: !timedOut };
}

export async function clearAssessmentDataOffline(
  type: AssessmentDataType,
  assessmentId: string,
  options?: { bypassTempGuard?: boolean }
) {
  // SAFETY: Only allow clearing data for temp-IDs (used during temp-to-permanent ID migration)
  // Unless explicitly bypassed for orphan cleanup
  if (!assessmentId.startsWith('temp-') && !options?.bypassTempGuard) {
    console.error(`[SAFETY] Blocked clear ${type} operation on non-temp ID:`, assessmentId);
    return;
  }

  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = assessmentStoreNameMap[type];
      
      // Use a SINGLE read-write transaction for atomic batch delete
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.store;
      const index = store.index('by-assessment');
      
      const existingData = await index.getAll(assessmentId);
      
      // Batch all deletes within the same transaction
      const deletePromises = existingData.map(item => store.delete(item.id));
      await Promise.all(deletePromises);
      await tx.done;
      
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Cleared ${type} for assessment:`, assessmentId);
      }
    },
    undefined,
    `clearAssessmentDataOffline:${type}`
  );
}

// Training functions
/**
 * Save a training to IndexedDB.
 * Throws `IdbSaveError` on hard failure (Gap 2.1) — callers MUST handle rejection.
 */
export async function saveTrainingOffline(
  training: Record<string, unknown> & { id?: string; child_count_hint?: number; dirty?: boolean },
  opts?: { childCountHint?: number }
): Promise<SaveResult> {
  const result = await withIndexedDBSaveBoundary(
    async () => {
      const db = await getDB();
      if (opts?.childCountHint != null && opts.childCountHint >= 0) {
        training.child_count_hint = opts.childCountHint;
      }
      // C3: stamp the dirty flag at every user-facing save.
      training.dirty = true;
      await db.put('trainings', training as never);
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Saved training:', training.id);
      }
    },
    'saveTrainingOffline',
    training,
  );
  // Audit M3: see saveInspectionOffline.
  dispatchSyncRecordsUpdated();
  return result;
}

/**
 * Ingest a remote record (delivered via Realtime UPDATE/INSERT) into IndexedDB.
 *
 * Mode B fix — the cross-device "recurring pending sync" loop:
 *
 *   When two devices are logged in as the same user, every cross-device edit
 *   triggers a Realtime broadcast. The receiving device used to route the
 *   payload through `saveInspectionOffline` / `saveTrainingOffline` /
 *   `saveDailyAssessmentOffline`, which unconditionally stamp `dirty: true`
 *   because that flag is the authoritative "has unshipped edits" signal for
 *   user-facing saves. Result: the receiving device immediately re-flagged
 *   the record as unsynced, fired its own sync, broadcast a Realtime echo
 *   back to the originator, which re-flagged the record on _that_ device,
 *   and so on. The badge oscillated between PENDING / SYNCED forever and
 *   users (especially those with tablet + desktop both signed in) saw
 *   recurring "pending sync" notifications even when the record was already
 *   on the server.
 *
 * This function exists to break that loop. It writes the remote payload to
 * IndexedDB with:
 *   - `dirty: false` (the server already has the row — no edits to upload)
 *   - `synced_at: record.updated_at` (no drift vs the local copy)
 *   - no `sync-records-updated` dispatch (would needlessly poke the autosync
 *     scheduler down to the fast interval even though nothing is unsynced).
 *
 * The boundary wrapper is preserved so the same emergency-localStorage
 * fallback / layer-breaker / circuit-breaker logic applies — Realtime
 * ingest must not crash the autosync hook on a transient IDB failure.
 */
export async function ingestRemoteRecordOffline(
  table: 'inspections' | 'trainings' | 'daily_assessments',
  record: Record<string, unknown> & { id?: string; updated_at?: string | null },
): Promise<SaveResult> {
  const enriched = {
    ...record,
    synced_at: record.updated_at || new Date().toISOString(),
    dirty: false,
  };
  return withIndexedDBSaveBoundary(
    async () => {
      const db = await getDB();
      await db.put(table, enriched as never);
      if (import.meta.env.DEV) {
        const labels: Record<typeof table, string> = {
          inspections: 'inspection',
          trainings: 'training',
          daily_assessments: 'daily assessment',
        };
        console.log(`[Offline Storage] Ingested remote ${labels[table]}:`, record.id);
      }
    },
    // Operation name includes `save:` so the `withIndexedDBSaveBoundary`
    // tier-selection at lines 2072-2090 routes inspections to the 8s `write`
    // tier (matching `saveInspectionOffline`). Without `save:`, the inspections
    // case matches no keyword and falls through to the 5s `light` tier —
    // inconsistent with the user-facing save path and prone to spurious
    // timeouts on stressed mobile devices. `trainings` and `daily_assessments`
    // already match the earlier `training` / `assessment` keywords → batch tier.
    `ingestRemoteRecordOffline:save:${table}`,
    enriched,
    { store: table },
  );
}

export async function getOfflineTrainings(userId?: string, isSuperAdmin?: boolean) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const allTrainings = await db.getAll('trainings');
      
      // Filter out soft-deleted records so they don't reappear on dashboard
      // C9 (P2): Also filter out quarantined remote-deleted records.
      const activeTrainings = allTrainings.filter(t => !t.deleted_at && isNotQuarantined(t));
      
      // Super admins see all reports - bypass user filtering
      if (isSuperAdmin) {
        return activeTrainings;
      }
      
      // Filter by user ID if provided (for privacy on shared devices)
      if (userId) {
        return activeTrainings.filter(t => t.inspector_id === userId);
      }
      
      return activeTrainings;
    },
    [],
    'getOfflineTrainings'
  );
}

export async function getOfflineTraining(id: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      return await db.get('trainings', id);
    },
    null,
    'getOfflineTraining',
    { store: 'trainings', criticalRead: true }
  );
}

export async function deleteOfflineTraining(id: string) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      
      // WAL BACKUP: Snapshot before delete for recovery
      try {
        const record = await db.get('trainings', id);
        if (record) {
          await createReportBackup('training', id, record);
        }
      } catch (backupErr) {
        console.warn('[Offline Storage] Pre-delete backup failed for training:', backupErr);
      }
      
      await db.delete('trainings', id);
    },
    undefined,
    'deleteOfflineTraining'
  );
}

export async function getUnsyncedTrainings(userId?: string, options?: WedgeLedgerFallbackOptions) {
  // Mode 11A: see `getUnsyncedInspections` above.
  return withWedgeLedgerFallback(
    () => withIndexedDBReadBoundary(
    async () => {
      const db = await getDB();
      
      // Audit M1: cap (see getUnsyncedInspections).
      const all = await db.getAll('trainings', undefined, UNSYNCED_SCAN_CAP);
      void maybeReportUnsyncedScanOverflow(db, 'trainings', all.length, 'getUnsyncedTrainings');
      // S40 (Fix A): Ownership filter before drift check (see getUnsyncedInspections).
      // Audit H1: `isSessionQuarantined` is now a static import (file head).
      const candidates = all.filter(isNotQuarantined).filter(record => {
        if (!userId) return true;
        if (record.inspector_id === userId) return true;
        if (record.id?.startsWith('temp-')) return true;
        return false;
      }).filter(record => !isSessionQuarantined(record.id)); // S41 (Fix E): see getUnsyncedInspections

      const unsynced = candidates.filter(record => {
        // C3: dirty flag = authoritative "has unshipped edits"; drift = secondary.
        if ((record as { dirty?: unknown }).dirty === true) return true;
        if (!record.synced_at) return true;
        if (record.updated_at) {
          // M4: Parse each timestamp once per record (see getUnsyncedInspections).
          const updatedMs = new Date(record.updated_at).getTime();
          const syncedMs = new Date(record.synced_at).getTime();
          return isUpdatedAheadOfSync(updatedMs, syncedMs);
        }
        return false;
      });

      const orphanCount = userId
        ? unsynced.filter(t => t.inspector_id !== userId && t.id?.startsWith('temp-')).length
        : 0;
      if (orphanCount > 0) {
        console.warn('[Offline Storage] Found orphaned temp-ID trainings:', { count: orphanCount });
      }
      
      console.log('[Offline Storage] Unsynced trainings:', {
        total: unsynced.length,
        userId: userId ? userId.substring(0, 8) + '...' : 'all',
      });
      
      return unsynced;
    },
    'getUnsyncedTrainings',
    { tier: 'batch', store: 'trainings' }
  ),
    'training',
    userId,
    'getUnsyncedTrainings',
    options,
  );
}

// `getUnsyncedCounts` (batched single-transaction reader) was removed (Fix C2).
// It used `withIndexedDBErrorBoundary` with an empty-array fallback, which
// silently turned IDB hiccups into "queue empty" — zeroing the badge and
// tripping the sync early-exit. Callers must now use the three individual
// `getUnsynced{Inspections,Trainings,DailyAssessments}` readers in parallel
// and inspect each result with `isIdbReadFailure` so a failed read never
// masquerades as an empty queue.

export async function queueTrainingOperation(type: 'create' | 'update' | 'delete', trainingId: string, data: Record<string, unknown>) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.add('training_operations', {
        type,
        trainingId,
        data,
        timestamp: Date.now(),
        retries: 0,
      });
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Queued training operation:', { type, trainingId });
      }
      
      // S8: registerInspectionSync removed (no-op since SW sync is disabled).
    },
    undefined,
    'queueTrainingOperation'
  );
}

export async function getQueuedTrainingOperations() {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const operations = await db.getAll('training_operations');
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Queued training operations:', operations.length);
      }
      return operations;
    },
    [],
    'getQueuedTrainingOperations'
  );
}

export async function removeQueuedTrainingOperation(id: number | undefined | null) {
  if (id === undefined || id === null) {
    console.warn('[Offline Storage] Cannot remove training operation with undefined/null ID');
    return;
  }
  
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.delete('training_operations', id);
      
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Removed queued training operation:', id);
      }
    },
    undefined,
    'removeQueuedTrainingOperation'
  );
}

export async function incrementTrainingOperationRetry(id: number | undefined | null) {
  if (id === undefined || id === null) {
    console.warn('[Offline Storage] Cannot increment retry for training operation with undefined/null ID');
    return;
  }
  
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const operation = await db.get('training_operations', id);
      if (operation) {
        operation.retries += 1;
        await db.put('training_operations', operation);
      }
    },
    undefined,
    'incrementTrainingOperationRetry'
  );
}

type TrainingDataType = 'delivery_approaches' | 'operating_systems' | 'immediate_attention' | 'verifiable_items' | 'systems_in_place' | 'summary';
type TrainingStoreNames = 'training_delivery_approaches' | 'training_operating_systems' | 'training_immediate_attention' | 'training_verifiable_items' | 'training_systems_in_place' | 'training_summary';

const trainingStoreNameMap: Record<TrainingDataType, TrainingStoreNames> = {
  delivery_approaches: 'training_delivery_approaches',
  operating_systems: 'training_operating_systems',
  immediate_attention: 'training_immediate_attention',
  verifiable_items: 'training_verifiable_items',
  systems_in_place: 'training_systems_in_place',
  summary: 'training_summary',
};

export async function saveTrainingDataOffline(
  type: TrainingDataType,
  trainingId: string,
  data: Record<string, unknown>[] | Record<string, unknown>,
  options?: { allowEmpty?: boolean }
) {
  // SAFETY: Never overwrite existing IndexedDB data with an empty array
  // UNLESS allowEmpty is explicitly set (user deliberately cleared all items)
  const items = Array.isArray(data) ? data : [data];
  if (items.length === 0 && !options?.allowEmpty) {
    console.warn(`[Offline Storage] Blocked save of empty ${type} array for ${trainingId} -- preserving existing data`);
    return;
  }

  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = trainingStoreNameMap[type];
      
      // Use a SINGLE read-write transaction for atomic batch operations
      // This matches the optimized pattern in saveRelatedDataOffline
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.store;
      const index = store.index('by-training');
      
      // Get existing data within the transaction
      const existingData = await index.getAll(trainingId);
      
      // items already computed above (with empty-array guard)
      
      // Batch all operations within the same transaction (no await between operations)
      const deletePromises = existingData.map(item => store.delete(item.id));
      const putPromises = items.map(item => {
        const dataWithTrainingId = {
          ...item,
          training_id: trainingId,
          // Use crypto.randomUUID() for proper UUID generation instead of composite IDs
          // This fixes the "Invalid uuid" validation error during sync
          id: ensureValidUUID(item.id as string | undefined),
        };
        return store.put(dataWithTrainingId);
      });
      
      // Execute all operations in parallel, then wait for transaction to complete
      await Promise.all([...deletePromises, ...putPromises]);
      await tx.done;
      
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Saved training ${type}:`, items.length, 'items');
      }

      // S30: Recompute child_count_hint on the parent (fire-and-forget).
      void recomputeTrainingChildCountHint(db, trainingId, type, items.length);
    },
    undefined,
    `saveTrainingDataOffline:${type}`
  );
}

export async function getTrainingDataOffline(
  type: TrainingDataType,
  trainingId: string
): Promise<DbRow[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = trainingStoreNameMap[type];
      const index = db.transaction(storeName).store.index('by-training');
      const results = await index.getAll(trainingId);
      return results.sort((a, b) => {
        const ac = (a as { created_at?: string | number }).created_at ?? 0;
        const bc = (b as { created_at?: string | number }).created_at ?? 0;
        return new Date(ac).getTime() - new Date(bc).getTime();
      });
    },
    [],
    `getTrainingDataOffline:${type}`
  );
}

/** Status-aware variant — see getRelatedDataOfflineWithStatus. */
export async function getTrainingDataOfflineWithStatus(
  type: TrainingDataType,
  trainingId: string
): Promise<{ items: DbRow[]; readSucceeded: boolean }> {
  if (isCircuitBreakerOpen('trainings')) {
    return { items: [], readSucceeded: false };
  }
  const { data, timedOut } = await withIDBTimeout<DbRow[]>(
    `getTrainingData(${type}/${trainingId})`,
    'batch',
    () => getTrainingDataOffline(type, trainingId),
    [],
  );
  return { items: data ?? [], readSucceeded: !timedOut };
}

export async function clearTrainingDataOffline(
  type: TrainingDataType,
  trainingId: string,
  options?: { bypassTempGuard?: boolean }
) {
  // SAFETY: Only allow clearing data for temp-IDs (used during temp-to-permanent ID migration)
  // Unless explicitly bypassed for orphan cleanup
  if (!trainingId.startsWith('temp-') && !options?.bypassTempGuard) {
    console.error(`[SAFETY] Blocked clear ${type} operation on non-temp ID:`, trainingId);
    return;
  }

  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const storeName = trainingStoreNameMap[type];
      
      // Use a SINGLE read-write transaction for atomic batch delete
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.store;
      const index = store.index('by-training');
      
      const existingData = await index.getAll(trainingId);
      
      // Batch all deletes within the same transaction
      const deletePromises = existingData.map(item => store.delete(item.id));
      await Promise.all(deletePromises);
      await tx.done;
      
      if (import.meta.env.DEV) {
        console.log(`[Offline Storage] Cleared ${type} for training:`, trainingId);
      }
    },
    undefined,
    `clearTrainingDataOffline:${type}`
  );
}

// ============= WRITE-AHEAD LOG (WAL) BACKUP FUNCTIONS =============
// Before destructive operations, snapshot current data into report_backups store.
// Keeps last 3 versions per report for recovery.

const MAX_BACKUPS_PER_REPORT = 3;

/**
 * Create a WAL backup of a report's current state before destructive operations.
 * @param backupCategory - Optional category prefix to separate WAL (pre-delete) from version snapshots.
 *   'wal' = pre-delete snapshots, 'ver' = version snapshots. Default: 'wal'.
 *   Each category has its own 3-slot limit, preventing pre-delete backups from evicting version snapshots.
 */
export async function createReportBackup(
  reportType: string,
  reportId: string,
  data: Record<string, unknown>,
  backupCategory: 'wal' | 'ver' = 'wal'
): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const reportKey = `${backupCategory}_${reportType}_${reportId}`;
      const backupId = `${reportKey}_${Date.now()}`;
      
      // Write the new backup
      await db.put('report_backups', {
        id: backupId,
        reportType,
        reportId,
        reportKey,
        timestamp: Date.now(),
        data,
      });
      
      // Prune old backups (keep last MAX_BACKUPS_PER_REPORT)
      const tx = db.transaction('report_backups', 'readwrite');
      const index = tx.store.index('by-report');
      const allBackups = await index.getAll(reportKey);
      
      if (allBackups.length > MAX_BACKUPS_PER_REPORT) {
        // Sort by timestamp descending, delete the oldest
        allBackups.sort((a, b) => b.timestamp - a.timestamp);
        const toDelete = allBackups.slice(MAX_BACKUPS_PER_REPORT);
        for (const old of toDelete) {
          await tx.store.delete(old.id);
        }
      }
      
      await tx.done;
      
      if (import.meta.env.DEV) {
        console.log(`[WAL Backup] Created backup for ${reportType}:`, reportId.substring(0, 8));
      }
    },
    undefined,
    `createReportBackup:${reportType}`
  );
}

/**
 * Restore the most recent backup for a report.
 */
export async function restoreFromBackup(
  reportType: string,
  reportId: string
): Promise<Record<string, unknown> | null> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      // Search both WAL and version backup categories
      const walKey = `wal_${reportType}_${reportId}`;
      const verKey = `ver_${reportType}_${reportId}`;
      const legacyKey = `${reportType}_${reportId}`; // Backward compat with pre-category backups
      const index = db.transaction('report_backups').store.index('by-report');
      
      const [walBackups, verBackups, legacyBackups] = await Promise.all([
        index.getAll(walKey),
        index.getAll(verKey),
        index.getAll(legacyKey),
      ]);
      
      const allBackups = [...walBackups, ...verBackups, ...legacyBackups];
      if (allBackups.length === 0) return null;
      
      // Return the most recent backup across all categories
      allBackups.sort((a, b) => b.timestamp - a.timestamp);
      return allBackups[0].data;
    },
    null,
    `restoreFromBackup:${reportType}`
  );
}

/**
 * List all available WAL backups (for recovery dashboard).
 */
export async function listAllBackups(): Promise<Array<{
  id: string;
  reportType: string;
  reportId: string;
  timestamp: number;
}>> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const allBackups = await db.getAll('report_backups');
      return allBackups.map(b => ({
        id: b.id,
        reportType: b.reportType,
        reportId: b.reportId,
        timestamp: b.timestamp,
      })).sort((a, b) => b.timestamp - a.timestamp);
    },
    [],
    'listAllBackups'
  );
}

// ============= AUTOCOMPLETE HISTORY HELPERS =============

export interface AutocompleteEntry {
  id: string; // compound key: `${field_type}::${value}`
  field_type: string;
  value: string;
  usage_count: number;
  last_used_at: string;
  synced: boolean;
}

/**
 * Get all autocomplete entries for a given field type, sorted by usage_count desc.
 */
export async function getAutocompleteHistory(fieldType: string): Promise<AutocompleteEntry[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const all = await db.getAllFromIndex('autocomplete_history', 'by-field-type', fieldType);
      return all.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
    },
    [],
    'getAutocompleteHistory'
  );
}

/**
 * Put (create or update) an autocomplete entry in IndexedDB.
 */
/**
 * L-3 (audit): coerce `synced` to 0|1 at every write site so the
 * `by-synced` IDB index keys the row. IDB silently drops booleans from
 * indexes — see also `toUploadedFlag` for the photos contract.
 */
function toAutocompleteSyncedFlag(v: unknown): 0 | 1 {
  return v === true || v === 1 ? 1 : 0;
}

export async function putAutocompleteEntry(entry: AutocompleteEntry): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.put('autocomplete_history', {
        ...entry,
        synced: toAutocompleteSyncedFlag(entry.synced) as unknown as boolean,
      });
    },
    undefined,
    'putAutocompleteEntry'
  );
}

/**
 * Delete an autocomplete entry from IndexedDB by its compound key.
 */
export async function deleteAutocompleteEntry(id: string): Promise<void> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.delete('autocomplete_history', id);
    },
    undefined,
    'deleteAutocompleteEntry'
  );
}

/**
 * Get all unsynced autocomplete entries (for background push to server).
 * L-3 (audit): index now keys numeric 0|1; query with plain 0.
 */
export async function getUnsyncedAutocompleteEntries(): Promise<AutocompleteEntry[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const rows = await db.getAllFromIndex(
        'autocomplete_history',
        'by-synced',
        IDBKeyRange.only(0 as unknown as IDBValidKey),
      );
      // Surface to callers as boolean for the public AutocompleteEntry type.
      return rows.map(r => ({ ...r, synced: false }));
    },
    [],
    'getUnsyncedAutocompleteEntries'
  );
}

/**
 * Bulk-put multiple autocomplete entries (used during server→local merge).
 */
export async function bulkPutAutocompleteEntries(entries: AutocompleteEntry[]): Promise<void> {
  if (entries.length === 0) return;
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tx = db.transaction('autocomplete_history', 'readwrite');
      await Promise.all(entries.map(e => tx.store.put({
        ...e,
        synced: toAutocompleteSyncedFlag(e.synced) as unknown as boolean,
      })));
      await tx.done;
    },
    undefined,
    'bulkPutAutocompleteEntries'
  );
}

// ============= STORAGE EVICTION FUNCTIONS =============

/**
 * Child store names grouped by parent store type.
 * Used for cascading eviction of synced report data.
 */
const INSPECTION_CHILD_STORES = [
  'inspection_systems', 'inspection_ziplines', 'inspection_equipment',
  'inspection_standards', 'inspection_summary',
] as const;

const TRAINING_CHILD_STORES = [
  'training_delivery_approaches', 'training_operating_systems',
  'training_immediate_attention', 'training_verifiable_items',
  'training_systems_in_place', 'training_summary',
] as const;

const ASSESSMENT_CHILD_STORES = [
  'daily_assessment_beginning_of_day', 'daily_assessment_end_of_day',
  'daily_assessment_operating_systems', 'daily_assessment_equipment_checks',
  'daily_assessment_structure_checks', 'daily_assessment_environment_checks',
] as const;

/**
 * Get the current route's report ID (if any) to avoid evicting the open report.
 */
function getCurrentReportId(): string | null {
  const path = window.location.pathname;
  const match = path.match(/\/(inspection|training|daily-assessment)\/([^/]+)/);
  return match ? match[2] : null;
}

/**
 * Evict synced reports older than `ageDays` from IndexedDB.
 * Only evicts records where synced_at >= updated_at (confirmed synced).
 * Returns the number of evicted parent records.
 */
export async function evictSyncedReports(ageDays: number): Promise<number> {
  let evictedCount = 0;
  const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;
  const currentReportId = getCurrentReportId();

  try {
    const db = await getDB();

    // Helper to evict from a parent store + its child stores
    const evictFromStore = async (
      parentStoreName: 'inspections' | 'trainings' | 'daily_assessments',
      childStores: readonly string[],
      childIndexPrefix: string,
      photoIndexField: string,
    ) => {
      const readTx = db.transaction(parentStoreName, 'readonly');
      const allRecords = await readTx.store.getAll();
      await readTx.done;

      // V8: Pre-scan unsynced photo IDs to skip eviction for any report with pending uploads.
      // Photos store has its own 'by-uploaded' index; do this once per evict pass, not per record.
      const unsyncedReportIds = new Set<string>();
      if (db.objectStoreNames.contains('photos')) {
        try {
          const photoTx = db.transaction('photos', 'readonly');
          const allPhotos = await photoTx.store.getAll();
          await photoTx.done;
          for (const p of allPhotos) {
            if (p && p.uploaded === 0 && p.inspectionId) {
              unsyncedReportIds.add(p.inspectionId);
            }
          }
        } catch (e) {
          console.warn('[Eviction] Failed to scan unsynced photos -- skipping eviction this pass:', e);
          return; // Be conservative: if we can't verify, skip eviction entirely
        }
      }

      const RECENT_EDIT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
      const nowMs = Date.now();

      for (const record of allRecords) {
        const id = record.id;
        if (!id || id === currentReportId) continue;

        // Safety: only evict if synced and not modified since sync
        const syncedAt = record.synced_at ? new Date(record.synced_at).getTime() : 0;
        const updatedAt = record.updated_at ? new Date(record.updated_at).getTime() : 0;
        if (!syncedAt || syncedAt < updatedAt) continue;
        if (syncedAt > cutoff) continue;

        // V8: Skip if parent was edited within the last 30 minutes regardless of synced_at.
        // (Defends against a stale synced_at stamped while another tab was editing.)
        if (updatedAt && (nowMs - updatedAt) < RECENT_EDIT_WINDOW_MS) {
          if (import.meta.env.DEV) {
            console.log(`[Eviction] Skip ${id.substring(0, 8)} -- recently edited (<30 min)`);
          }
          continue;
        }

        // V8: Skip if there are any unsynced (uploaded === 0) photos for this report.
        if (unsyncedReportIds.has(id)) {
          if (import.meta.env.DEV) {
            console.log(`[Eviction] Skip ${id.substring(0, 8)} -- has unsynced photos`);
          }
          continue;
        }

        // Evict parent + children in a single transaction.
        // Store names are runtime-built from config; narrow via StoreNames<InspectionDB>
        // when handing them to the typed db.transaction/objectStore APIs.
        type OSName = StoreNames<InspectionDB>;
        const allStoreNames = [parentStoreName, ...childStores, 'photos'];
        const availableStores = allStoreNames.filter(
          s => db.objectStoreNames.contains(s as OSName),
        ) as OSName[];
        const deleteTx = db.transaction(availableStores, 'readwrite');

        deleteTx.objectStore(parentStoreName as OSName).delete(id);

        // Evict child records
        for (const childStore of childStores) {
          if (!db.objectStoreNames.contains(childStore as OSName)) continue;
          const store = deleteTx.objectStore(childStore as OSName);
          const indexName = `by-${childIndexPrefix}`;
          if (store.indexNames.contains(indexName as never)) {
            const childKeys = await store.index(indexName as never).getAllKeys(id as never);
            for (const key of childKeys) {
              await store.delete(key);
            }
          }
        }

        // Evict photo metadata for this report
        if (db.objectStoreNames.contains('photos')) {
          const photoStore = deleteTx.objectStore('photos');
          if (photoStore.indexNames.contains('by-inspection')) {
            const photoKeys = await photoStore.index('by-inspection').getAllKeys(id);
            for (const key of photoKeys) {
              await photoStore.delete(key);
            }
          }
        }

        await deleteTx.done;
        evictedCount++;
      }
    };

    await evictFromStore('inspections', INSPECTION_CHILD_STORES, 'inspection', 'inspectionId');
    await evictFromStore('trainings', TRAINING_CHILD_STORES, 'training', 'trainingId');
    await evictFromStore('daily_assessments', ASSESSMENT_CHILD_STORES, 'assessment', 'assessmentId');

  } catch (error) {
    console.warn('[Eviction] evictSyncedReports failed:', error);
  }

  return evictedCount;
}

/**
 * Evict report_backups entries older than `ageDays`.
 * Returns number of evicted entries.
 */
export async function evictOldReportBackups(ageDays: number): Promise<number> {
  let evictedCount = 0;
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('report_backups')) return 0;

    const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;
    const tx = db.transaction('report_backups', 'readwrite');
    const index = tx.store.index('by-timestamp');

    // IDBKeyRange.upperBound gets all entries with timestamp <= cutoff
    const range = IDBKeyRange.upperBound(cutoff);
    let cursor = await index.openCursor(range);
    while (cursor) {
      await cursor.delete();
      evictedCount++;
      cursor = await cursor.continue();
    }
    await tx.done;

    if (evictedCount > 0 && import.meta.env.DEV) {
      console.log(`[Eviction] Removed ${evictedCount} old report_backups entries`);
    }
  } catch (error) {
    console.warn('[Eviction] evictOldReportBackups failed:', error);
  }
  return evictedCount;
}

/**
 * Garbage-collect photos whose parent inspection has been stuck on a temp-* id
 * for longer than `ageDays`. Covers two failure modes:
 *   1. Parent was deleted from IDB before sync (orphan) — already filtered from
 *      live queue, but the row still consumes storage.
 *   2. Parent still exists but its sync keeps failing (validation/RLS) so its
 *      id never gets rewritten to a real UUID. Without this GC the blob sits
 *      in IDB forever, growing storage on every failed-sync device.
 *
 * Safety: only deletes rows whose `inspectionId` STILL starts with `temp-` at
 * the moment of GC. If the parent later syncs successfully and `relinkPhotosToNewInspectionId`
 * rewrites the id to a UUID, the photo is no longer eligible for this eviction.
 *
 * Default age = 30 days. Returns count of evicted photos.
 */
export async function evictStuckTempPhotos(ageDays: number = 30): Promise<number> {
  let evictedCount = 0;
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('photos')) return 0;

    const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;
    const tx = db.transaction('photos', 'readwrite');
    let cursor = await tx.store.openCursor();
    while (cursor) {
      const photo = cursor.value;
      if (
        photo.inspectionId?.startsWith('temp-') &&
        photo.uploaded === 0 &&
        typeof photo.timestamp === 'number' &&
        photo.timestamp < cutoff
      ) {
        await cursor.delete();
        evictedCount++;
      }
      cursor = await cursor.continue();
    }
    await tx.done;

    if (evictedCount > 0 && import.meta.env.DEV) {
      console.log(`[Eviction] Removed ${evictedCount} stuck temp-* photos older than ${ageDays}d`);
    }
  } catch (error) {
    console.warn('[Eviction] evictStuckTempPhotos failed:', error);
  }
  return evictedCount;
}

/**
 * Evict photo metadata rows where blob is null (already uploaded) and synced older than ageDays.
 */
export async function evictSyncedPhotoMetadata(ageDays: number): Promise<number> {
  let evictedCount = 0;
  try {
    const db = await getDB();
    if (!db.objectStoreNames.contains('photos')) return 0;

    const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;
    const currentReportId = getCurrentReportId();

    const tx = db.transaction('photos', 'readwrite');
    let cursor = await tx.store.openCursor();
    while (cursor) {
      const photo = cursor.value;
      // Only evict if: blob already nullified, uploaded, and old enough
      if (
        photo.blob === null &&
        photo.uploaded === 1 &&
        photo.timestamp < cutoff &&
        photo.inspectionId !== currentReportId
      ) {
        await cursor.delete();
        evictedCount++;
      }
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (error) {
    console.warn('[Eviction] evictSyncedPhotoMetadata failed:', error);
  }
  return evictedCount;
}

// ============= EQUIPMENT TYPE CACHE =============

interface EquipmentTypeCacheEntry {
  id: string;
  equipment_category: string;
  label: string;
  display_order: number;
  is_active: boolean;
  synced: boolean;
}

export async function getEquipmentTypeOptions(category: string): Promise<EquipmentTypeCacheEntry[]> {
  return withIndexedDBErrorBoundary(async () => {
    const db = await getDB();
    const all = await db.getAllFromIndex('equipment_type_cache', 'by-category', category);
    return all.filter(e => e.is_active).sort((a, b) => a.display_order - b.display_order);
  }, [], 'getEquipmentTypeOptions');
}

export async function putEquipmentTypeOption(entry: EquipmentTypeCacheEntry): Promise<void> {
  return withIndexedDBErrorBoundary(async () => {
    const db = await getDB();
    await db.put('equipment_type_cache', entry);
  }, undefined, 'putEquipmentTypeOption');
}

export async function bulkPutEquipmentTypeOptions(entries: EquipmentTypeCacheEntry[]): Promise<void> {
  return withIndexedDBErrorBoundary(async () => {
    const db = await getDB();
    const tx = db.transaction('equipment_type_cache', 'readwrite');
    for (const entry of entries) {
      await tx.store.put(entry);
    }
    await tx.done;
  }, undefined, 'bulkPutEquipmentTypeOptions');
}

// ─── C9: Remote-deleted quarantine helpers ─────────────────────────────────
// When a sync detects the server-side row has been soft-deleted but the
// local copy still has unsynced edits, we mark the local parent with
// `_remote_deleted_at` + `_quarantine_reason` instead of wiping it. The
// dashboard / list-getters and getUnsynced* filters skip quarantined rows
// via `isNotQuarantined` (P2 — single source of truth); the user resolves
// them via RemoteDeletedConflictDialog.
//
// These helpers are intentionally additive — no existing call sites change.

/**
 * P2: Single source of truth for "is this row NOT quarantined by C9".
 * Used by every dashboard reader and every getUnsynced* filter so the
 * three call sites can never drift apart.
 *
 * Function declaration (hoisted) so it is callable from earlier-in-file
 * readers without a forward-reference error.
 */
export function isNotQuarantined<T extends Record<string, unknown>>(record: T): boolean {
  return !record._remote_deleted_at;
}

export type QuarantineTable = 'inspections' | 'trainings' | 'daily_assessments';

export interface QuarantinedRecord {
  table: QuarantineTable;
  id: string;
  organization?: string | null;
  location?: string | null;
  site?: string | null;
  remoteDeletedAt: string;
  reason: string;
  raw: Record<string, unknown>;
}

export async function quarantineRecord(
  table: QuarantineTable,
  id: string,
  remoteDeletedAt: string,
  reason: string = 'remote_soft_delete',
): Promise<boolean> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const row = await db.get(table, id);
      if (!row) return false;
      const updated = {
        ...row,
        _remote_deleted_at: remoteDeletedAt,
        _quarantine_reason: reason,
      };
      await db.put(table, updated);
      if (import.meta.env.DEV) {
        console.warn('[C9] Quarantined local record (remote was soft-deleted):', {
          table,
          id: id.substring(0, 8),
          remoteDeletedAt,
        });
      }
      return true;
    },
    false,
    'quarantineRecord',
  );
}

export async function getQuarantinedRecords(
  table?: QuarantineTable,
): Promise<QuarantinedRecord[]> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const tables: QuarantineTable[] = table
        ? [table]
        : ['inspections', 'trainings', 'daily_assessments'];
      const out: QuarantinedRecord[] = [];
      for (const t of tables) {
        const all = await db.getAll(t);
        for (const r of all as Record<string, unknown>[]) {
          if (r._remote_deleted_at) {
            out.push({
              table: t,
              id: String(r.id),
              organization: (r.organization as string | null | undefined) ?? null,
              location: (r.location as string | null | undefined) ?? null,
              site: (r.site as string | null | undefined) ?? null,
              remoteDeletedAt: String(r._remote_deleted_at),
              reason: String(r._quarantine_reason ?? 'remote_soft_delete'),
              raw: r,
            });
          }
        }
      }
      return out;
    },
    [],
    'getQuarantinedRecords',
  );
}

/** Permanently discard a quarantined record + its children (user-confirmed). */
export async function discardQuarantinedRecord(
  table: QuarantineTable,
  id: string,
): Promise<void> {
  switch (table) {
    case 'inspections':
      await deleteOfflineInspection(id);
      return;
    case 'trainings':
      await deleteOfflineTraining(id);
      return;
    case 'daily_assessments':
      await deleteOfflineDailyAssessment(id);
      return;
  }
}

/**
 * Clone a quarantined parent + all its children under a fresh UUID, mark
 * the new copy dirty (synced_at = null) so the next sync uploads it as a
 * new report on the server, and remove the quarantined original from IDB.
 *
 * Returns the new id, or null if the quarantined record could not be found.
 */
export async function restoreQuarantinedAsNew(
  table: QuarantineTable,
  id: string,
): Promise<string | null> {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      const row = await db.get(table, id);
      if (!row) return null;

      const newId = crypto.randomUUID();
      const nowIso = new Date().toISOString();

      // Strip quarantine + sync state on the clone so it looks like a
      // brand-new local record to the next sync cycle.
      const clone: Record<string, unknown> = {
        ...(row as Record<string, unknown>),
        id: newId,
        synced_at: null,
        updated_at: nowIso,
        created_at: nowIso,
        client_idempotency_key: null,
        // Keep deleted_at clear — this is a fresh report.
        deleted_at: null,
        deleted_by: null,
        retention_until: null,
      };
      delete clone._remote_deleted_at;
      delete clone._quarantine_reason;

      // Copy children with rewritten parent FK and fresh ids.
      const childStores: Record<QuarantineTable, { name: string; fk: string; index: string }[]> = {
        inspections: [
          { name: 'systems', fk: 'inspection_id', index: 'by-inspection' },
          { name: 'ziplines', fk: 'inspection_id', index: 'by-inspection' },
          { name: 'equipment', fk: 'inspection_id', index: 'by-inspection' },
          { name: 'standards', fk: 'inspection_id', index: 'by-inspection' },
          { name: 'summary', fk: 'inspection_id', index: 'by-inspection' },
          { name: 'inspection_photos', fk: 'inspection_id', index: 'by-inspection' },
        ],
        trainings: [
          { name: 'training_delivery_approaches', fk: 'training_id', index: 'by-training' },
          { name: 'training_operating_systems', fk: 'training_id', index: 'by-training' },
          { name: 'training_immediate_attention', fk: 'training_id', index: 'by-training' },
          { name: 'training_verifiable_items', fk: 'training_id', index: 'by-training' },
          { name: 'training_systems_in_place', fk: 'training_id', index: 'by-training' },
          { name: 'training_summary', fk: 'training_id', index: 'by-training' },
          { name: 'training_photos', fk: 'training_id', index: 'by-training' },
        ],
        daily_assessments: [
          { name: 'daily_assessment_beginning_of_day', fk: 'assessment_id', index: 'by-assessment' },
          { name: 'daily_assessment_end_of_day', fk: 'assessment_id', index: 'by-assessment' },
          { name: 'daily_assessment_operating_systems', fk: 'assessment_id', index: 'by-assessment' },
          { name: 'daily_assessment_equipment_checks', fk: 'assessment_id', index: 'by-assessment' },
          { name: 'daily_assessment_structure_checks', fk: 'assessment_id', index: 'by-assessment' },
          { name: 'daily_assessment_environment_checks', fk: 'assessment_id', index: 'by-assessment' },
          { name: 'daily_assessment_photos', fk: 'assessment_id', index: 'by-assessment' },
        ],
      };

      // Write the new parent.
      await db.put(table, clone as never);

      type OSName = StoreNames<InspectionDB>;
      for (const store of childStores[table]) {
        try {
          const storeName = store.name as OSName;
          const idx = db.transaction(storeName).store.index(store.index as never);
          const children = await idx.getAll(id as never);
          if (!children || children.length === 0) continue;
          const tx = db.transaction(storeName, 'readwrite');
          for (const child of children as Record<string, unknown>[]) {
            const newChild = {
              ...child,
              id: crypto.randomUUID(),
              [store.fk]: newId,
            };
            await tx.store.put(newChild as never);
          }
          await tx.done;
        } catch (err) {
          // Non-fatal — a missing/empty child store shouldn't block the restore.
          if (import.meta.env.DEV) {
            console.warn('[C9] restoreQuarantinedAsNew: child copy skipped', {
              store: store.name,
              err,
            });
          }
        }
      }

      // Drop the original quarantined parent + its children. Children under
      // the old id are now orphaned in IDB — clear them too.
      try {
        for (const store of childStores[table]) {
          const storeName = store.name as OSName;
          const idx = db.transaction(storeName).store.index(store.index as never);
          const children = await idx.getAll(id as never);
          if (!children || children.length === 0) continue;
          const tx = db.transaction(storeName, 'readwrite');
          for (const child of children as { id: string }[]) {
            await tx.store.delete(child.id);
          }
          await tx.done;
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[C9] restoreQuarantinedAsNew: old child cleanup skipped', err);
        }
      }
      try {
        await db.delete(table, id);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[C9] restoreQuarantinedAsNew: old parent cleanup skipped', err);
        }
      }

      if (import.meta.env.DEV) {
        console.log('[C9] Restored quarantined record as new:', {
          table,
          oldId: id.substring(0, 8),
          newId: newId.substring(0, 8),
        });
      }
      return newId;
    },
    null,
    'restoreQuarantinedAsNew',
  );
}

// ─── M6: Periodic GC for unresolved quarantined records ─────────────────────
// Quarantined rows (`_remote_deleted_at` set) stay in IDB forever waiting
// for the user to resolve via RemoteDeletedConflictDialog. If the user
// never sees / never resolves the dialog (uninstalled UI, multi-device,
// dismissed), they accumulate as IDB garbage and the dashboard filters
// keep paying the scan cost. After 30d we hard-delete them — far past any
// realistic resolution window.

const QUARANTINE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const GC_CYCLE_INTERVAL = 20; // run every Nth sync cycle
const GC_MIN_INTERVAL_MS = 60_000; // hard rate-limit: at most once per minute
let gcCycleCounter = 0;
let lastGcRunAt = 0;

export interface QuarantineGcResult {
  inspections: number;
  trainings: number;
  daily_assessments: number;
  total: number;
}

/**
 * Hard-delete any quarantined record whose `_remote_deleted_at` is older
 * than the TTL. Removes the parent + all child rows via the existing
 * delete*Offline helpers so storage stays consistent.
 *
 * Safe to call on any cadence — the GC_MIN_INTERVAL_MS guard prevents
 * stampedes if the caller invokes it eagerly.
 *
 * @param ttlMs Override the default 30-day TTL (test hook).
 * @returns Counts of records removed per table, plus total.
 */
export async function gcQuarantinedRecords(ttlMs: number = QUARANTINE_TTL_MS): Promise<QuarantineGcResult> {
  const result: QuarantineGcResult = {
    inspections: 0,
    trainings: 0,
    daily_assessments: 0,
    total: 0,
  };

  try {
    const all = await getQuarantinedRecords();
    const cutoff = Date.now() - ttlMs;

    for (const q of all) {
      const ts = Date.parse(q.remoteDeletedAt);
      if (!Number.isFinite(ts)) continue;
      if (ts > cutoff) continue; // still inside the resolution window

      try {
        switch (q.table) {
          case 'inspections':
            await deleteOfflineInspection(q.id);
            result.inspections++;
            break;
          case 'trainings':
            await deleteOfflineTraining(q.id);
            result.trainings++;
            break;
          case 'daily_assessments':
            await deleteOfflineDailyAssessment(q.id);
            result.daily_assessments++;
            break;
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[M6] gcQuarantinedRecords: delete failed', {
            table: q.table,
            id: q.id.substring(0, 8),
            err,
          });
        }
      }
    }

    result.total = result.inspections + result.trainings + result.daily_assessments;
    if (import.meta.env.DEV && result.total > 0) {
      console.log('[M6] Quarantine GC removed expired records:', result);
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[M6] gcQuarantinedRecords: scan failed', err);
    }
  }

  return result;
}

/**
 * Cycle-throttled wrapper for `gcQuarantinedRecords`. Designed to be called
 * from the sync loop's finally-block — runs at most every Nth cycle AND no
 * more than once per minute.
 *
 * Mirrors the M3 cycle-probe pattern (see `maybeRunCycleProbe`).
 */
export function maybeRunQuarantineGc(): void {
  gcCycleCounter += 1;
  if (gcCycleCounter < GC_CYCLE_INTERVAL) return;
  const now = Date.now();
  if (now - lastGcRunAt < GC_MIN_INTERVAL_MS) {
    // Still rate-limited; reset counter so we try again next cycle.
    gcCycleCounter = 0;
    return;
  }
  gcCycleCounter = 0;
  lastGcRunAt = now;
  // Fire and forget — never block the sync loop.
  void gcQuarantinedRecords();
}

/** Test hook — reset counter + last-run so tests can drive maybeRunQuarantineGc. */
export function __resetQuarantineGcStateForTests(): void {
  gcCycleCounter = 0;
  lastGcRunAt = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// forceDeleteLocalRecord
//
// Surgical delete that bypasses the IDB layer breaker / circuit breaker. Used
// by the Sync Terminal "DROP" button so users can clear ghost pending rows
// even when the breaker is open and the normal `deleteOffline*` helpers would
// silently no-op into the localStorage fallback (which doesn't hold the row).
//
// Strategy:
//   1. Try the normal delete path with a short timeout (1.5s). When the
//      breaker is closed and IDB is healthy this is the cheapest path and
//      also clears any sibling caches that the normal helper knows about.
//   2. If that fails or times out, open a short-lived `idb.openDB(name)`
//      connection (no version) directly. This skips `getDB()` / circuit
//      breaker / health check entirely and just tries to delete by key.
//   3. Independently, scrub the localStorage emergency-save snapshot
//      (`rw_backup_<reportType>_<id>`) so the wedge-ledger fallback path
//      doesn't keep re-surfacing the row in unsynced counts.
// ─────────────────────────────────────────────────────────────────────────────

const STORE_FOR_TABLE = {
  inspections: 'inspections',
  trainings: 'trainings',
  daily_assessments: 'daily_assessments',
} as const;
const BACKUP_KEY_PREFIX = {
  inspections: 'rw_backup_inspection_',
  trainings: 'rw_backup_training_',
  daily_assessments: 'rw_backup_daily_assessment_',
} as const;

export type ForceDeletableTable = keyof typeof STORE_FOR_TABLE;

export interface ForceDeleteResult {
  deletedFromIdb: boolean;
  deletedFromLocalStorage: boolean;
  bypassedBreaker: boolean;
  error?: string;
}

async function deleteByDirectOpen(
  table: ForceDeletableTable,
  id: string,
): Promise<boolean> {
  // Direct openDB(name) — no version, no schema upgrade, no circuit breaker.
  // 2s hard timeout so a wedged factory can't hang the user gesture.
  const DB_NAME = 'rope-works-inspections';
  let db: IDBPDatabase<unknown> | null = null;
  try {
    db = await Promise.race<IDBPDatabase<unknown>>([
      openDB<unknown>(DB_NAME) as unknown as Promise<IDBPDatabase<unknown>>,
      new Promise<IDBPDatabase<unknown>>((_, reject) =>
        setTimeout(() => reject(new Error('direct_openDB_timeout')), 2000),
      ),
    ]);
    const storeName = STORE_FOR_TABLE[table];
    if (!db.objectStoreNames.contains(storeName)) return false;
    await Promise.race<void>([
      (db.delete(storeName as never, id) as unknown as Promise<void>),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('direct_delete_timeout')), 1500),
      ),
    ]);
    return true;
  } catch (err) {
    console.warn('[forceDeleteLocalRecord] direct-open delete failed:', err);
    return false;
  } finally {
    try { db?.close(); } catch { /* noop */ }
  }
}

function purgeLocalStorageBackup(table: ForceDeletableTable, id: string): boolean {
  try {
    const key = BACKUP_KEY_PREFIX[table] + id;
    const had = localStorage.getItem(key) !== null;
    if (had) localStorage.removeItem(key);
    return had;
  } catch {
    return false;
  }
}

export async function forceDeleteLocalRecord(
  table: ForceDeletableTable,
  id: string,
): Promise<ForceDeleteResult> {
  const result: ForceDeleteResult = {
    deletedFromIdb: false,
    deletedFromLocalStorage: false,
    bypassedBreaker: false,
  };

  // Always scrub localStorage backup — it's cheap and synchronous.
  result.deletedFromLocalStorage = purgeLocalStorageBackup(table, id);

  // 1) Try the normal helper with a tight timeout. When healthy this also
  //    clears child caches the normal helper knows about.
  const normalHelper =
    table === 'inspections'
      ? deleteOfflineInspection
      : table === 'trainings'
        ? deleteOfflineTraining
        : deleteOfflineDailyAssessment;
  try {
    await Promise.race<void>([
      Promise.resolve(normalHelper(id)).then(() => undefined),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('normal_delete_timeout')), 1500),
      ),
    ]);
    result.deletedFromIdb = true;
  } catch (err) {
    console.warn('[forceDeleteLocalRecord] normal helper failed, falling back:', err);
    // 2) Bypass: open IDB directly and delete the row.
    const ok = await deleteByDirectOpen(table, id);
    result.deletedFromIdb = ok;
    result.bypassedBreaker = true;
    if (!ok) result.error = 'idb_unreachable';
  }

  console.warn('[forceDeleteLocalRecord] result', { table, id: id.substring(0, 8), ...result });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// One-shot purge of the known "Airiel Crawler World" ghost.
// The server row was permanently deleted in the May 2026 cleanup migration,
// but devices that were offline during the deletion still hold the local
// daily_assessments row and keep showing it in PENDING REPORTS forever.
// Self-removes after one successful run via a localStorage flag.
// ─────────────────────────────────────────────────────────────────────────────
const GHOST_PURGE_FLAG = '__rw_purged_airiel_v1';
const AIRIEL_GHOST_ID = 'c24b6198-4a5f-4541-ad0c-825b27f3bdc0';

export async function runOneShotGhostPurge(): Promise<void> {
  try {
    if (localStorage.getItem(GHOST_PURGE_FLAG) === 'true') return;
    const result = await forceDeleteLocalRecord('daily_assessments', AIRIEL_GHOST_ID);
    if (result.deletedFromIdb || result.deletedFromLocalStorage) {
      console.warn('[ghost-purge] Removed Airiel Crawler World ghost', result);
    }
    // Mark done either way — if the row didn't exist, there's nothing to do
    // on subsequent boots either.
    localStorage.setItem(GHOST_PURGE_FLAG, 'true');
  } catch (err) {
    console.warn('[ghost-purge] purge attempt failed (will retry next boot):', err);
  }
}

// Fire-and-forget on module load. Delayed slightly so it doesn't compete
// with cold-start IDB open during the first paint.
if (typeof window !== 'undefined') {
  setTimeout(() => { void runOneShotGhostPurge(); }, 8000);
}
