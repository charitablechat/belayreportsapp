/**
 * Drain Mode — user-initiated foreground "push everything now" state.
 *
 * Why a module-level singleton (not React state):
 *   - `useAutoSync` reads `isDrainModeActive()` inside its periodic interval
 *     to switch the cadence to a fast tick. A React-context value would force
 *     `useAutoSync` to re-mount its interval/effect chain on every change.
 *   - The wake lock + auto-stop timer is a global side-effect; it has no
 *     business living inside a component tree.
 *
 * Lifecycle:
 *   start() → acquires wake lock, kicks performSync via the registered runner,
 *            schedules a hard 10-min safety stop. While active, useAutoSync
 *            uses DRAIN_SYNC_INTERVAL (5s) instead of the normal cadence.
 *   stop()  → releases wake lock, clears safety timer, notifies subscribers.
 *
 * Auto-stop:
 *   The owner (SyncPulse) calls stop() when unsyncedCount drops to 0 or the
 *   user taps STOP. The 10-min safety cap fires here as a backstop so a
 *   forgotten drain can't pin the wake lock indefinitely.
 */
import { acquireScreenWakeLock, releaseScreenWakeLock } from '@/lib/wake-lock';

export const DRAIN_SYNC_INTERVAL_MS = 5_000;
const SAFETY_STOP_MS = 10 * 60 * 1000;

type Listener = (active: boolean) => void;
type Runner = () => void | Promise<void>;

let active = false;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let runner: Runner | null = null;
const listeners = new Set<Listener>();

function notify() {
  for (const l of Array.from(listeners)) {
    try { l(active); } catch { /* ignore */ }
  }
}

/**
 * Register the function that drain mode should call to actually perform a
 * sync cycle. `useAutoSync` registers `performSync` here on mount.
 */
export function registerDrainRunner(fn: Runner): () => void {
  runner = fn;
  return () => {
    if (runner === fn) runner = null;
  };
}

export function isDrainModeActive(): boolean {
  return active;
}

export function subscribeDrainMode(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function startDrainMode(): Promise<{ wakeLockHeld: boolean }> {
  if (active) {
    return { wakeLockHeld: true };
  }
  active = true;
  const wakeLockHeld = await acquireScreenWakeLock();
  if (safetyTimer) clearTimeout(safetyTimer);
  safetyTimer = setTimeout(() => {
    void stopDrainMode('safety-cap');
  }, SAFETY_STOP_MS);
  notify();
  // Kick a sync immediately — the user explicitly asked for it.
  try { void runner?.(); } catch { /* ignore */ }
  return { wakeLockHeld };
}

export async function stopDrainMode(_reason?: 'user' | 'complete' | 'safety-cap'): Promise<void> {
  if (!active) return;
  active = false;
  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
  await releaseScreenWakeLock();
  notify();
}
