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
 */
export function recordSyncFailure(recordId: string, error: string): boolean {
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
