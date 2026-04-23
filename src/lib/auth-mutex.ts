/**
 * Phase 2 — Auth mutex.
 *
 * Serializes auth-state-changing operations (login, refresh, logout,
 * offline-session-create, online reconciliation) so concurrent callers don't
 * race against each other. Reuses a tiny internal queue rather than pulling
 * a dependency, and exposes `runWithAuthMutex(label, fn)` plus a
 * `isAuthBusy()` probe so UI buttons can show pending state.
 *
 * Important: this does NOT replace the Supabase auth-js Navigator LockManager
 * — it sits one layer above so our own call sites stop firing redundant
 * refreshes while another op is mid-flight.
 */
export type AuthOpLabel =
  | 'login'
  | 'logout'
  | 'refresh'
  | 'offline-session-create'
  | 'reconcile-offline'
  | 'other';

let busy = false;
let activeLabel: AuthOpLabel | null = null;
let queue: Array<() => void> = [];

export function isAuthBusy(): boolean {
  return busy;
}

export function activeAuthOp(): AuthOpLabel | null {
  return activeLabel;
}

function acquire(): Promise<void> {
  if (!busy) {
    busy = true;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    queue.push(() => {
      busy = true;
      resolve();
    });
  });
}

function release(): void {
  busy = false;
  activeLabel = null;
  const next = queue.shift();
  if (next) next();
}

export async function runWithAuthMutex<T>(
  label: AuthOpLabel,
  fn: () => Promise<T>
): Promise<T> {
  await acquire();
  activeLabel = label;
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Try to run immediately; if the mutex is held, return `{ skipped: true }`.
 * Useful for second-presses of a sign-in button — we want a no-op rather
 * than queueing a duplicate login.
 */
export async function tryRunWithAuthMutex<T>(
  label: AuthOpLabel,
  fn: () => Promise<T>
): Promise<{ skipped: true } | { skipped: false; value: T }> {
  if (busy) return { skipped: true };
  const value = await runWithAuthMutex(label, fn);
  return { skipped: false, value };
}
