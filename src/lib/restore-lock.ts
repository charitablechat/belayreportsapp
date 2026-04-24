/**
 * Restore Lock (H2 + N-H)
 * ────────────────────────
 * The restore flow (DataRecoveryTool → saveInspection/Training/AssessmentOffline)
 * writes records with `synced_at = null` and `updated_at = Date.now()`. If the
 * auto-sync cycle fires while the restore is mid-flight (or 1-2s after, before
 * the user has even navigated to the restored report), the restored record can:
 *
 *  1. Be picked up by an in-flight batch and pushed to the server using the
 *     T0 snapshot still living in the atomic-sync closure (see C4).
 *  2. Be re-overwritten by a post-commit local save that clobbers the
 *     freshly-restored child rows.
 *
 * The restore flow is the user's emergency recovery tool — it must be atomic
 * against sync. This module exposes a tiny ref-counted lock that:
 *
 *   • performSync() in useAutoSync checks `isRestoreInProgress()` early and
 *     bails out (the next sync-data-changed / interval tick will retry).
 *   • Restore handlers wrap their work in `withRestoreLock(async () => …)`,
 *     which increments on entry and decrements on exit (even on throw).
 *
 * Multiple concurrent restores are supported via ref-counting so that a bulk
 * "restore N snapshots" action (future) doesn't unlock between iterations.
 *
 * N-H (crash safety):
 * The in-memory ref-count alone is not tab-crash-safe. If the tab is killed
 * by the OS (iOS memory pressure, backgrounded PWA, user swipe-closing
 * between the start of a large restore and its completion), the next
 * launch has `_restoreCount = 0` but IndexedDB still holds partially-written
 * records with `synced_at = null`. Auto-sync would then push those
 * half-written rows to the server before the user finishes the restore.
 *
 * Mitigation: persist a timestamp + operation id to sessionStorage each time
 * the lock transitions from idle → held. On module load we check for a
 * stale entry (< 15 minutes old) and, if present, block sync for the
 * remainder of that window so the user has a chance to re-open the tab
 * and resume the restore (or let it time out cleanly).
 *
 * sessionStorage (not localStorage) because:
 *   • Per-tab: a tab crash clears the storage, so a *fresh* launch in a
 *     new tab doesn't inherit the ghost lock. Only reloads of the crashed
 *     tab see it — which is exactly the case we want to guard.
 *   • Survives reloads: React StrictMode double-mounts, visibilitychange
 *     bailouts, and the `beforeunload → reload` refresh loop all preserve
 *     sessionStorage.
 */

const PERSIST_KEY = "restore-lock-v1";
// 15 minutes is enough for any legitimate restore (largest inspections in
// the field run < 5 min). After that window, a lingering entry is treated
// as stale and the lock is released.
const CRASH_TTL_MS = 15 * 60 * 1000;

interface PersistedLockState {
  heldSince: number;
  /** Incremented each time the lock is acquired; used as a tie-breaker. */
  epoch: number;
}

let _restoreCount = 0;
const listeners = new Set<(active: boolean) => void>();

function notify(active: boolean) {
  listeners.forEach(l => {
    try { l(active); } catch (err) { console.error('[RestoreLock] listener error', err); }
  });
}

function readPersisted(): PersistedLockState | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.heldSince === "number" &&
      typeof parsed.epoch === "number"
    ) {
      return parsed as PersistedLockState;
    }
    return null;
  } catch {
    return null;
  }
}

function writePersisted(state: PersistedLockState | null): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (state === null) {
      sessionStorage.removeItem(PERSIST_KEY);
    } else {
      sessionStorage.setItem(PERSIST_KEY, JSON.stringify(state));
    }
  } catch {
    /* sessionStorage unavailable or full — the in-memory lock still works;
       crash safety is the only thing we lose. */
  }
}

/**
 * True while at least one restore is in flight. Sync cycles MUST short-circuit
 * when this returns true.
 *
 * N-H: Also returns true if a stale persisted lock from a recent tab crash
 * is still within its TTL window; the next call after the window passes
 * auto-clears the stale entry.
 */
export function isRestoreInProgress(): boolean {
  if (_restoreCount > 0) return true;
  const persisted = readPersisted();
  if (!persisted) return false;
  const age = Date.now() - persisted.heldSince;
  if (age >= CRASH_TTL_MS) {
    // Stale entry from a long-ago crash — self-heal.
    writePersisted(null);
    return false;
  }
  return true;
}

/**
 * Subscribe to lock state transitions (false → true on first acquire, true →
 * false on final release). Returns an unsubscribe.
 */
export function onRestoreLockChange(listener: (active: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Run `fn` while the restore lock is held. Lock is released even if `fn`
 * throws. Safe to nest / interleave with other restores.
 */
export async function withRestoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const wasIdle = _restoreCount === 0;
  _restoreCount += 1;
  if (wasIdle) {
    if (import.meta.env.DEV) console.log('[RestoreLock] acquired (sync paused)');
    // N-H: persist so a tab crash between here and the finally block still
    // blocks the next launch's first sync cycle.
    const prev = readPersisted();
    writePersisted({
      heldSince: Date.now(),
      epoch: (prev?.epoch ?? 0) + 1,
    });
    notify(true);
  }
  try {
    return await fn();
  } finally {
    _restoreCount -= 1;
    if (_restoreCount <= 0) {
      _restoreCount = 0;
      if (import.meta.env.DEV) console.log('[RestoreLock] released (sync resumed)');
      // N-H: clear the persisted sentinel on clean release.
      writePersisted(null);
      notify(false);
    }
  }
}

/**
 * N-H: Force-clear a stale persisted lock. Primarily for diagnostics / the
 * DataRecoveryTool "reset" action. Does NOT touch the in-memory ref count —
 * an actually-held lock is unaffected.
 */
export function clearPersistedRestoreLock(): void {
  writePersisted(null);
}
