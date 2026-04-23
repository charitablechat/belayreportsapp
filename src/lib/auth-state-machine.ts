/**
 * Phase 2 — Auth state machine.
 *
 * Replaces the ad-hoc booleans scattered across components with five explicit
 * states. Subscribers (RequireAuth, AuthenticatedHeader, Auth screen) react
 * to state transitions instead of polling localStorage on every render.
 *
 * Feature-flagged via `localStorage.AUTH_FSM`:
 *   - "1"  → enabled (default in this build)
 *   - "0"  → disabled (legacy code paths still run; FSM only mirrors)
 * Call `isAuthFsmEnabled()` from a feature flag check; the machine itself
 * always runs so we can collect telemetry, but consumers can opt-out for one
 * release if a regression appears.
 *
 * Valid transitions:
 *   BOOTING → ONLINE_AUTHENTICATED | OFFLINE_AUTHENTICATED | UNAUTHENTICATED
 *   ONLINE_AUTHENTICATED ↔ TRANSITIONING ↔ OFFLINE_AUTHENTICATED
 *   any → UNAUTHENTICATED (sign-out / hard reset)
 *   UNAUTHENTICATED → ONLINE_AUTHENTICATED | OFFLINE_AUTHENTICATED
 */

export type AuthState =
  | 'BOOTING'
  | 'ONLINE_AUTHENTICATED'
  | 'OFFLINE_AUTHENTICATED'
  | 'TRANSITIONING'
  | 'UNAUTHENTICATED';

export interface AuthSnapshot {
  state: AuthState;
  userId: string | null;
  email: string | null;
  reason: string | null;
  changedAt: number;
}

const VALID: Record<AuthState, AuthState[]> = {
  BOOTING: [
    'ONLINE_AUTHENTICATED',
    'OFFLINE_AUTHENTICATED',
    'UNAUTHENTICATED',
    'TRANSITIONING',
  ],
  ONLINE_AUTHENTICATED: [
    'TRANSITIONING',
    'OFFLINE_AUTHENTICATED',
    'UNAUTHENTICATED',
    'ONLINE_AUTHENTICATED', // identity refresh
  ],
  OFFLINE_AUTHENTICATED: [
    'TRANSITIONING',
    'ONLINE_AUTHENTICATED',
    'UNAUTHENTICATED',
    'OFFLINE_AUTHENTICATED',
  ],
  TRANSITIONING: [
    'ONLINE_AUTHENTICATED',
    'OFFLINE_AUTHENTICATED',
    'UNAUTHENTICATED',
  ],
  UNAUTHENTICATED: [
    'ONLINE_AUTHENTICATED',
    'OFFLINE_AUTHENTICATED',
    'TRANSITIONING',
  ],
};

let snapshot: AuthSnapshot = {
  state: 'BOOTING',
  userId: null,
  email: null,
  reason: 'init',
  changedAt: Date.now(),
};

const listeners = new Set<(s: AuthSnapshot) => void>();

export function getAuthState(): AuthSnapshot {
  return snapshot;
}

export function subscribeAuthState(
  fn: (s: AuthSnapshot) => void
): () => void {
  listeners.add(fn);
  // Fire immediately so subscribers don't have to mirror the read.
  try { fn(snapshot); } catch { /* ignore */ }
  return () => { listeners.delete(fn); };
}

export interface TransitionInput {
  to: AuthState;
  reason: string;
  userId?: string | null;
  email?: string | null;
}

/**
 * Attempt a state transition. Returns true if applied, false if rejected
 * (invalid edge). Identity-only refreshes (same state, new userId/email) are
 * always allowed.
 */
export function transition(input: TransitionInput): boolean {
  const { to, reason, userId, email } = input;
  const from = snapshot.state;

  if (from !== to && !VALID[from]?.includes(to)) {
    if (import.meta.env.DEV) {
      console.warn('[AuthFSM] Rejected transition', { from, to, reason });
    }
    return false;
  }

  const next: AuthSnapshot = {
    state: to,
    userId: userId !== undefined ? userId : snapshot.userId,
    email: email !== undefined ? email : snapshot.email,
    reason,
    changedAt: Date.now(),
  };

  // Skip notification on identity-noop (same state + same id + same email).
  const identical =
    next.state === snapshot.state &&
    next.userId === snapshot.userId &&
    next.email === snapshot.email;
  if (identical) return true;

  snapshot = next;

  if (import.meta.env.DEV) {
    console.log('[AuthFSM]', from, '→', to, `(${reason})`);
  }

  listeners.forEach((l) => {
    try { l(snapshot); } catch { /* swallow */ }
  });
  return true;
}

export function isAuthFsmEnabled(): boolean {
  try {
    const raw = localStorage.getItem('AUTH_FSM');
    if (raw === '0') return false;
    return true;
  } catch {
    return true;
  }
}

/**
 * Convenience: derive the current auth-ish boolean for legacy callers.
 * Returns true for ONLINE_AUTHENTICATED + OFFLINE_AUTHENTICATED.
 */
export function isAuthenticated(s: AuthSnapshot = snapshot): boolean {
  return (
    s.state === 'ONLINE_AUTHENTICATED' || s.state === 'OFFLINE_AUTHENTICATED'
  );
}
