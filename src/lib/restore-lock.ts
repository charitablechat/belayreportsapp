/**
 * Restore Lock (H2)
 * ─────────────────
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
 */

let _restoreCount = 0;
const listeners = new Set<(active: boolean) => void>();

function notify(active: boolean) {
  listeners.forEach(l => {
    try { l(active); } catch (err) { console.error('[RestoreLock] listener error', err); }
  });
}

/**
 * True while at least one restore is in flight. Sync cycles MUST short-circuit
 * when this returns true.
 */
export function isRestoreInProgress(): boolean {
  return _restoreCount > 0;
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
    notify(true);
  }
  try {
    return await fn();
  } finally {
    _restoreCount -= 1;
    if (_restoreCount <= 0) {
      _restoreCount = 0;
      if (import.meta.env.DEV) console.log('[RestoreLock] released (sync resumed)');
      notify(false);
    }
  }
}
