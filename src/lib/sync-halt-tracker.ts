/**
 * Sync halt-reason tracker.
 *
 * `useAutoSync.performSync` has roughly a dozen early-return paths that abort
 * the cycle before any work runs. Most are silent (`syncLog.log` only) and
 * never surface in the UI. From the user's point of view the badge keeps
 * showing "37 PENDING" with no signal whether the engine is paused, broken,
 * or merely waiting for a cooldown to clear. Belay's iPad complaint
 * (2026-04-22) traced directly to this gap.
 *
 * This module is the writer side: every silent-return path in `performSync`
 * calls `recordSyncHalt(reason)`, and a successful (or attempted) sync calls
 * `clearSyncHalt()`. The reader side (`getSyncHaltState` + `subscribeSyncHalt`)
 * powers a new "PAUSED" phase in `SyncPulse` that surfaces the reason in
 * plain English with an optional auto-resume countdown.
 *
 * Design notes:
 *  - Pure module-level state, no React deps. Reused from non-component
 *    callers (atomic-sync-manager future hook, edge-function probes).
 *  - Subscribers are fire-and-forget; one bad subscriber can't poison the
 *    state machine.
 *  - `legitimate` halts (in-flight piggy-back, MIN_SYNC_INTERVAL debounce)
 *    do NOT record a halt — they're expected coordination, not failure.
 *    Only the actionable halt classes are tracked.
 */

export type SyncHaltCode =
  | 'restore_in_progress'
  | 'circuit_breaker_open'
  | 'no_session'
  | 'auth_validation_timeout'
  | 'auth_no_valid_session'
  | 'idb_reads_failed';

export interface SyncHaltState {
  code: SyncHaltCode;
  /** Plain-English short label for the SyncPulse status pill. */
  label: string;
  /** Plain-English explanation for the terminal sheet. */
  detail: string;
  /** Epoch ms when this halt was recorded. */
  recordedAt: number;
  /**
   * Optional epoch ms when the halt is expected to auto-clear (e.g. circuit
   * breaker cooldown end). When set, the UI shows a countdown.
   */
  autoResumeAt?: number;
}

interface HaltMeta {
  label: string;
  detail: string;
}

const HALT_META: Record<SyncHaltCode, HaltMeta> = {
  restore_in_progress: {
    label: 'RESTORE',
    detail: 'A backup restore is in progress. Sync will resume automatically when the restore finishes.',
  },
  circuit_breaker_open: {
    label: 'COOLDOWN',
    detail: 'Local storage was unresponsive — sync is on a short cooldown. Tap RETRY NOW to override.',
  },
  no_session: {
    label: 'SIGN IN',
    detail: 'No active sign-in detected. Sign in to resume syncing.',
  },
  auth_validation_timeout: {
    label: 'AUTH SLOW',
    detail: 'Could not validate the session in time. Will retry on the next cycle; tap RETRY NOW to force it.',
  },
  auth_no_valid_session: {
    label: 'SIGN IN',
    detail: 'The cached session is no longer valid. Sign out and back in to resume sync.',
  },
  idb_reads_failed: {
    label: 'STORAGE',
    detail: 'Local storage reads timed out. Pending counts may be stale; will recover on the next successful read.',
  },
};

let current: SyncHaltState | null = null;
const subscribers = new Set<(state: SyncHaltState | null) => void>();

function emit(): void {
  if (subscribers.size === 0) return;
  const snapshot = Array.from(subscribers);
  for (const cb of snapshot) {
    try {
      cb(current);
    } catch {
      /* one bad subscriber must not break others */
    }
  }
}

/**
 * Record a halt. If `code` matches the current halt and the recorded time
 * is within 250ms, this is a no-op so a tight retry loop doesn't spam
 * subscribers. Otherwise the new halt replaces the old.
 */
export function recordSyncHalt(
  code: SyncHaltCode,
  options?: { autoResumeAt?: number },
): void {
  const now = Date.now();
  if (
    current &&
    current.code === code &&
    now - current.recordedAt < 250
  ) {
    if (options?.autoResumeAt && options.autoResumeAt !== current.autoResumeAt) {
      current = { ...current, autoResumeAt: options.autoResumeAt };
      emit();
    }
    return;
  }
  const meta = HALT_META[code];
  current = {
    code,
    label: meta.label,
    detail: meta.detail,
    recordedAt: now,
    autoResumeAt: options?.autoResumeAt,
  };
  emit();
}

/**
 * Clear the halt state. Called on every successful (or attempted, when no
 * silent halt fired) sync cycle so a transient halt doesn't stick once the
 * underlying condition resolves.
 */
export function clearSyncHalt(): void {
  if (current === null) return;
  current = null;
  emit();
}

/**
 * Snapshot read for component initial render. After mount components should
 * use `subscribeSyncHalt`.
 */
export function getSyncHaltState(): SyncHaltState | null {
  return current;
}

/**
 * Subscribe to halt-state changes. Returns an unsubscribe function.
 */
export function subscribeSyncHalt(
  callback: (state: SyncHaltState | null) => void,
): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/**
 * Test-only — reset module state between vitest runs.
 */
export function __resetSyncHaltForTests(): void {
  current = null;
  subscribers.clear();
}
