/**
 * Screen Wake Lock helper.
 *
 * Used by the iOS-friendly "Drain Pending" flow (see SyncPulse + drain-mode.ts):
 * iPad auto-lock kills a Safari tab in ~30s, which is shorter than one mobile
 * sync cycle (60s). Holding a screen wake lock during an explicit user-driven
 * drain keeps the tab alive long enough for the queue to actually flush.
 *
 * Notes:
 *  - Wake Lock API ships in iOS Safari 16.4+ and all installed PWAs. On older
 *    iOS the request rejects; callers should treat that as a graceful no-op
 *    and surface a "keep this screen on" hint via toast instead.
 *  - Safari releases the lock whenever the tab is hidden; we re-acquire on
 *    visibilitychange→visible while the user-facing intent (`active`) is still
 *    set. This module owns at most one sentinel at a time.
 */

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
};

let sentinel: WakeLockSentinelLike | null = null;
let active = false; // user-facing intent — survives tab-hidden cycles
let visibilityHandlerInstalled = false;

function isSupported(): boolean {
  try {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  } catch {
    return false;
  }
}

async function tryAcquire(): Promise<WakeLockSentinelLike | null> {
  if (!isSupported()) return null;
  try {
    const lock = await (navigator as unknown as {
      wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
    }).wakeLock.request('screen');
    lock.addEventListener('release', () => {
      // Browser released the lock (tab hidden, low battery, etc.). If the
      // user-facing intent is still active, the visibility handler will
      // re-acquire when the tab becomes visible again.
      if (sentinel === lock) sentinel = null;
    });
    return lock;
  } catch {
    return null;
  }
}

function ensureVisibilityHandler() {
  if (visibilityHandlerInstalled || typeof document === 'undefined') return;
  visibilityHandlerInstalled = true;
  document.addEventListener('visibilitychange', async () => {
    if (!active) return;
    if (document.visibilityState === 'visible' && !sentinel) {
      sentinel = await tryAcquire();
    }
  });
}

/** Acquire the screen wake lock. Returns true if a lock was obtained, false
 * if the API is unsupported or the request was denied. The caller's intent
 * is remembered until `release()` is called, so subsequent visibility changes
 * will re-acquire automatically. */
export async function acquireScreenWakeLock(): Promise<boolean> {
  active = true;
  ensureVisibilityHandler();
  if (sentinel && !sentinel.released) return true;
  sentinel = await tryAcquire();
  return !!sentinel;
}

/** Release the wake lock and clear the user-facing intent. Safe to call
 * even when nothing is held. */
export async function releaseScreenWakeLock(): Promise<void> {
  active = false;
  const current = sentinel;
  sentinel = null;
  if (current && !current.released) {
    try { await current.release(); } catch { /* ignore */ }
  }
}

/** Whether the Wake Lock API is available in this environment. */
export function isWakeLockSupported(): boolean {
  return isSupported();
}
