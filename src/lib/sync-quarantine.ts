/**
 * Sync Quarantine + Backoff (H5)
 * ──────────────────────────────
 * Per-item failure tracking so a record that exhausts its retries during one
 * sync cycle does not monopolize subsequent cycles. After N consecutive cycles
 * of failure the record is "quarantined" until the end of the current calendar
 * day (UTC); during that window getNextBatch-style callers can call
 * `filterQuarantined()` to drop it from the queue.
 *
 * Persistence: sessionStorage so the quarantine survives in-tab navigations
 * but never outlives the browser session — a fresh launch always retries.
 * (Day boundary is the secondary cap; sessionStorage is the primary.)
 *
 * Also exports a jittered exponential backoff helper used by atomic-sync-manager.
 */
// sessionStorage writes are intentionally direct — quarantine is a small,
// ephemeral, in-tab cache. The localStorage-only safeSetItem helper does not
// apply here, and the eslint rule that bans raw localStorage.setItem only
// targets `localStorage`, not `sessionStorage`.

import { syncLog } from "./sync-logger";

const STORAGE_KEY = "sync-quarantine-v1";
const FAILURE_THRESHOLD = 3; // cycles of consecutive failure

/**
 * H5-T: Transient-vs-persistent error classifier.
 *
 * `recordSyncFailure` previously incremented its 3-strike counter on every
 * error message regardless of cause, which meant a 15-30 s offline blip
 * during three consecutive adaptive-sync cycles was enough to quarantine a
 * record until end-of-day. The record then disappeared from
 * `getNextBatch`/`unsyncedCount` until the day rolled over — silently in
 * production, deterministically on CI.
 *
 * Network-class errors (offline, DNS, mid-flight cancellation, IDB-timeout
 * boundary) tell us nothing about whether the record itself is bad. They
 * only tell us the device couldn't reach the backend right now. We retry
 * those forever and only count *persistent* failures (4xx schema mismatch,
 * RLS denial, deserialization errors, etc.) toward the quarantine budget.
 *
 * Patterns are matched case-insensitively against the error message string
 * passed to `recordSyncFailure`. This is the same surface that
 * `atomic-sync-manager.ts` produces from `error instanceof Error ?
 * error.message : String(error)`.
 */
const TRANSIENT_NETWORK_PATTERNS: readonly RegExp[] = [
  // Chromium / Edge — fetch failed because offline or DNS unreachable.
  /failed to fetch/i,
  // Firefox — same condition, different copy.
  /networkerror when attempting to fetch resource/i,
  /networkerror/i,
  // Safari (pre-iOS 17) — its analog of "Failed to fetch".
  /load failed/i,
  // Chromium net-stack error codes that bubble through `Error: …`.
  /err_internet_disconnected/i,
  /err_network_changed/i,
  /err_name_not_resolved/i,
  /err_connection_(refused|reset|closed|aborted|timed_out)/i,
  /err_network/i,
  // Aborted in-flight request (typically `AbortController.abort()`,
  // tab navigation, or service-worker termination mid-fetch).
  /aborterror/i,
  /request was aborted/i,
  /the operation was aborted/i,
  // Timeouts raised by `withIDBTimeout` / `withTimeout` wrappers in the
  // sync hot path. These mean "we couldn't get a response in time" — the
  // record's contents aren't implicated.
  /timeouterror/i,
  /operation timed out/i,
  /supabase query timed out/i,
  // Mode 12: per-record `if (!navigator.onLine)` gate inside the atomic
  // sync functions throws this exact string. The condition is by definition
  // transient — `navigator.onLine` only reads false when Chromium's
  // NetworkChangeNotifier (or a CDP override) reports offline, both of
  // which resolve on their own when network is restored. Without this
  // pattern the retry loop sees a freshly-thrown `Error("Cannot sync while
  // offline")` (no cause chain to walk), classifies it persistent, and
  // collapses the budget to `persistentMaxRetries=1` mid-retry — which
  // deterministically quarantines a record any time `navigator.onLine`
  // briefly flaps during a transient REST flake. Production users on
  // flaky cell networks have been silently hitting this; CI made it
  // reproducible (PR #119 trace, run 25297495407).
  /cannot sync while offline/i,
];

/**
 * Returns true when the error message indicates a transient network /
 * timeout failure that should NOT count toward the quarantine threshold.
 *
 * Intentionally permissive: a message we can't classify falls through to
 * "persistent" so that genuinely-bad records still quarantine after 3
 * strikes — we'd rather over-quarantine a network blip we missed than
 * silently swallow a real schema-mismatch loop.
 */
export function isTransientNetworkError(message: string | null | undefined): boolean {
  if (!message) return false;
  return TRANSIENT_NETWORK_PATTERNS.some((re) => re.test(message));
}

interface QuarantineEntry {
  /** Number of consecutive failed sync cycles. */
  failures: number;
  /** Epoch ms when the record was first observed failing. */
  firstFailedAt: number;
  /** Epoch ms when quarantine expires (end of day). */
  quarantinedUntil: number | null;
  /** Last error message — kept for diagnostics. */
  lastError: string | null;
}

type QuarantineMap = Record<string, QuarantineEntry>;

function readMap(): QuarantineMap {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  // Different browsers report quota errors differently:
  //   Chrome/Edge: DOMException named "QuotaExceededError" with code 22
  //   Firefox:     DOMException "NS_ERROR_DOM_QUOTA_REACHED" with code 1014
  //   Safari:      DOMException "QuotaExceededError" with code 22
  const e = err as { name?: string; code?: number };
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  );
}

function writeMap(map: QuarantineMap): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    if (isQuotaError(err)) {
      // N-F: sessionStorage is full. A silent catch here means new failures
      // stop being recorded for the rest of the tab's life — quarantine
      // becomes effectively non-functional without the user ever knowing.
      // Prune oldest half of entries (by firstFailedAt) and retry once so
      // the quarantine map keeps working. If it still fails, fall through
      // to the warn below.
      syncLog.warn(
        "[SyncQuarantine] sessionStorage quota hit — pruning oldest entries",
      );
      try {
        const entries = Object.entries(map).sort(
          (a, b) => a[1].firstFailedAt - b[1].firstFailedAt,
        );
        const keepFrom = Math.floor(entries.length / 2);
        const pruned: QuarantineMap = {};
        for (let i = keepFrom; i < entries.length; i++) {
          pruned[entries[i][0]] = entries[i][1];
        }
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
        return;
      } catch (retryErr) {
        syncLog.warn(
          "[SyncQuarantine] sessionStorage write failed even after pruning:",
          retryErr,
        );
      }
    } else {
      syncLog.warn("[SyncQuarantine] sessionStorage write failed:", err);
    }
  }
}

/**
 * N-E: End-of-day boundary in LOCAL time (the device the user is operating).
 *
 * Previous implementation used `setUTCHours(23,59,59,999)`. For a user at
 * UTC-8 working at 20:00 local (04:00 UTC next day), the UTC-day boundary was
 * 03:59 local the following morning — a quarantine intended to "expire at end
 * of day" actually expired mid-night local time, and for users east of UTC it
 * expired during their working day. Using local time makes the behaviour
 * match the user's intuition regardless of timezone.
 */
function endOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * Record a failed sync attempt. Returns true if the record is now quarantined.
 *
 * H5-T: Transient network/timeout errors do NOT count toward the 3-strike
 * threshold — they short-circuit out before touching the map. See
 * `isTransientNetworkError` above for the rationale and pattern list.
 * Persistent errors (4xx/5xx with a body, schema mismatch, RLS denial,
 * deserialization, …) still increment as before.
 */
export function recordSyncFailure(recordId: string, error: string): boolean {
  if (isTransientNetworkError(error)) {
    // Don't count network blips toward quarantine. The record is fine; the
    // device just couldn't reach the backend. The next adaptive-sync cycle
    // will retry indefinitely without burning the quarantine budget.
    return false;
  }
  const map = readMap();
  const now = Date.now();
  const existing = map[recordId];

  const entry: QuarantineEntry = existing
    ? {
        failures: existing.failures + 1,
        firstFailedAt: existing.firstFailedAt,
        quarantinedUntil: existing.quarantinedUntil,
        lastError: error,
      }
    : {
        failures: 1,
        firstFailedAt: now,
        quarantinedUntil: null,
        lastError: error,
      };

  if (entry.failures >= FAILURE_THRESHOLD && !entry.quarantinedUntil) {
    entry.quarantinedUntil = endOfDay(now);
    syncLog.warn(
      `[SyncQuarantine] Record ${recordId.substring(0, 12)} quarantined until ${new Date(
        entry.quarantinedUntil,
      ).toISOString()} after ${entry.failures} failures: ${error}`,
    );
  }

  map[recordId] = entry;
  writeMap(map);
  return entry.quarantinedUntil !== null && now < entry.quarantinedUntil;
}

/**
 * Mark a record as recovered — clears any quarantine + failure counters.
 */
export function recordSyncSuccess(recordId: string): void {
  const map = readMap();
  if (!map[recordId]) return;
  delete map[recordId];
  writeMap(map);
}

/**
 * True if the record is currently quarantined (failed too many times today).
 * Auto-evicts expired entries.
 */
export function isQuarantined(recordId: string): boolean {
  const map = readMap();
  const entry = map[recordId];
  if (!entry) return false;
  const now = Date.now();
  if (entry.quarantinedUntil && now >= entry.quarantinedUntil) {
    delete map[recordId];
    writeMap(map);
    return false;
  }
  return entry.quarantinedUntil !== null && now < entry.quarantinedUntil;
}

/**
 * Filter a batch to drop quarantined records. Returns the kept items plus the
 * count of dropped items so callers can surface "N records skipped — will
 * retry tomorrow" in diagnostics.
 */
export function filterQuarantined<T extends { id: string }>(
  items: T[],
): { kept: T[]; dropped: number; droppedIds: string[] } {
  const droppedIds: string[] = [];
  const kept = items.filter((item) => {
    if (isQuarantined(item.id)) {
      droppedIds.push(item.id);
      return false;
    }
    return true;
  });
  return { kept, dropped: droppedIds.length, droppedIds };
}

/**
 * Jittered exponential backoff for per-item retries.
 * Schedule: attempt 1 → 1s, attempt 2 → 4s, attempt 3 → 12s.
 * Each delay gets ±20% jitter so retries from concurrent items don't
 * synchronize and slam the server.
 */
export function jitteredBackoffMs(attempt: number): number {
  // attempt is 1-indexed (the retry number).
  const base = Math.min(1000 * Math.pow(3, Math.max(0, attempt - 1)), 12000);
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(250, Math.round(base + jitter));
}

/**
 * L5 — Jittered exponential backoff for photo upload retries.
 *
 * Photos retry on every sync cycle (~30s desktop, ~60s mobile). Without a
 * per-photo cooldown, a network flake that fails N photos in cycle K causes
 * all N to retry together in cycle K+1, hitting the same conditions and
 * failing again as a herd. This schedule spreads them out so each photo
 * waits its own window before becoming eligible again.
 *
 * Schedule (attempt is 1-indexed; matches retryCount AFTER it has been
 * bumped, or `retryCount + 1` for transient failures that don't bump):
 *   attempt 1 → 5s   (one network blip; barely any delay)
 *   attempt 2 → 15s  (still next cycle on desktop)
 *   attempt 3 → 45s  (skip 1-2 cycles)
 *   attempt 4 → 135s (skip ~4 cycles)
 *   attempt 5+ → 300s (cap; ~10 cycles before dead-letter)
 *
 * Each delay carries ±20% jitter, evaluated ONCE at stamp time, so
 * concurrent failures don't all become eligible at the same future
 * instant. The caller stamps `photo.nextRetryAt = now + result` and
 * `getUnuploadedPhotos` skips photos with `nextRetryAt > now`.
 */
export function jitteredPhotoBackoffMs(attempt: number): number {
  // attempt is 1-indexed; clamp 0 → treat as attempt 1 (smallest delay).
  const safeAttempt = Math.max(1, attempt);
  const base = Math.min(5000 * Math.pow(3, safeAttempt - 1), 300_000);
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(1000, Math.round(base + jitter));
}

/** For diagnostics / admin tools. */
export function getQuarantineSnapshot(): QuarantineMap {
  return readMap();
}

/** Clear all quarantines — exposed for an admin "force retry all" action. */
export function clearAllQuarantines(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* non-critical */
  }
}
