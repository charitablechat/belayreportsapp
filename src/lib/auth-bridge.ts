/**
 * Phase 2 — Auth bridge.
 *
 * Hooks Supabase auth events + browser online/offline events into the
 * `auth-state-machine`. This module owns the singleton subscription so
 * components don't each re-register listeners.
 *
 * Also implements `reconcileOfflineSession()`: when transitioning
 * OFFLINE_AUTHENTICATED → ONLINE_AUTHENTICATED, exchange the cached
 * refresh token for a fresh online session in a single attempt. Wraps the
 * exchange in the auth mutex so concurrent reconciles can't race.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  transition,
  getAuthState,
  type AuthState,
} from '@/lib/auth-state-machine';
import { runWithAuthMutex } from '@/lib/auth-mutex';
import {
  readSyntheticSession,
  verifyAndReconcileOfflineAuth,
} from '@/lib/offline-auth';
import {
  getCachedUserFromStorage,
  hasCachedSessionForOffline,
  getOfflineUserId,
} from '@/lib/cached-auth';
import { isPlaceholderToken } from '@/lib/synthetic-session-guard';

let initialized = false;

function deriveCurrentState(): {
  state: AuthState;
  userId: string | null;
  email: string | null;
} {
  // 1) Real Supabase session?
  const cached = getCachedUserFromStorage();
  if (cached?.id) {
    // If we got the user from a real (non-placeholder) session, treat as ONLINE.
    const synthetic = readSyntheticSession();
    const isSynthetic = !!synthetic && synthetic.user?.id === cached.id;
    if (!isSynthetic) {
      return {
        state: 'ONLINE_AUTHENTICATED',
        userId: cached.id,
        email: (cached.email as string | undefined) ?? null,
      };
    }
  }

  // 2) Synthetic / offline session?
  const synthetic = readSyntheticSession();
  if (synthetic?.user?.id) {
    return {
      state: 'OFFLINE_AUTHENTICATED',
      userId: synthetic.user.id,
      email: synthetic.user.email ?? null,
    };
  }

  // 3) Last-resort offline id.
  if (!navigator.onLine && (hasCachedSessionForOffline() || getOfflineUserId())) {
    return {
      state: 'OFFLINE_AUTHENTICATED',
      userId: getOfflineUserId(),
      email: null,
    };
  }

  return { state: 'UNAUTHENTICATED', userId: null, email: null };
}

/**
 * Initialize the bridge once, at app boot. Safe to call multiple times.
 */
export function initAuthBridge(): void {
  if (initialized) return;
  initialized = true;

  // Seed state from current storage.
  const initial = deriveCurrentState();
  transition({
    to: initial.state,
    reason: 'boot:derive-from-storage',
    userId: initial.userId,
    email: initial.email,
  });

  // Subscribe to Supabase auth events.
  try {
    supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user?.id ?? null;
      const email = session?.user?.email ?? null;
      const isPlaceholder = isPlaceholderToken(session?.access_token);

      if (event === 'SIGNED_IN' && session?.user && !isPlaceholder) {
        transition({
          to: 'ONLINE_AUTHENTICATED',
          reason: 'supabase:SIGNED_IN',
          userId,
          email,
        });
      } else if (event === 'TOKEN_REFRESHED' && session?.user && !isPlaceholder) {
        transition({
          to: 'ONLINE_AUTHENTICATED',
          reason: 'supabase:TOKEN_REFRESHED',
          userId,
          email,
        });
      } else if (event === 'USER_UPDATED' && session?.user) {
        transition({
          to: getAuthState().state, // identity-only refresh
          reason: 'supabase:USER_UPDATED',
          userId,
          email,
        });
      } else if (event === 'SIGNED_OUT') {
        // Only flip to UNAUTHENTICATED when we are truly online; offline
        // SIGNED_OUT events are usually transient refresh failures and the
        // synthetic session should keep the user in.
        if (navigator.onLine) {
          const synthetic = readSyntheticSession();
          if (synthetic?.user?.id) {
            transition({
              to: 'OFFLINE_AUTHENTICATED',
              reason: 'supabase:SIGNED_OUT-with-synthetic',
              userId: synthetic.user.id,
              email: synthetic.user.email ?? null,
            });
          } else {
            transition({
              to: 'UNAUTHENTICATED',
              reason: 'supabase:SIGNED_OUT',
              userId: null,
              email: null,
            });
          }
        }
      }
    });
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[AuthBridge] Failed to attach onAuthStateChange', err);
    }
  }

  // Browser network events drive the OFFLINE↔ONLINE reconcile.
  window.addEventListener('online', () => {
    const current = getAuthState();
    if (current.state === 'OFFLINE_AUTHENTICATED') {
      reconcileOfflineSession().catch((err) => {
        if (import.meta.env.DEV) {
          console.warn('[AuthBridge] Online reconcile failed:', err);
        }
      });
    }
  });

  window.addEventListener('offline', () => {
    const current = getAuthState();
    // Don't tear the user out — just record state.
    if (current.state === 'ONLINE_AUTHENTICATED') {
      // Real Supabase session is still in localStorage; we just can't refresh.
      // Stay ONLINE_AUTHENTICATED until expiry; RequireAuth will reflect this.
      // No transition needed here.
    }
  });
}

/**
 * Idempotent: when transitioning OFFLINE → ONLINE, exchange the cached
 * refresh token for a fresh session in a single attempt. Wraps the call in
 * the auth mutex so concurrent reconciles serialize.
 */
export async function reconcileOfflineSession(): Promise<boolean> {
  return runWithAuthMutex('reconcile-offline', async () => {
    transition({
      to: 'TRANSITIONING',
      reason: 'reconcile:start',
    });

    const ok = await verifyAndReconcileOfflineAuth();
    if (ok) {
      // verifyAndReconcileOfflineAuth saved the new mapping; supabase auth
      // listener will already have fired SIGNED_IN/TOKEN_REFRESHED — but
      // re-derive defensively in case the listener was skipped.
      const next = deriveCurrentState();
      transition({
        to: next.state,
        reason: 'reconcile:success',
        userId: next.userId,
        email: next.email,
      });
      return true;
    }

    // Reconcile failed — verifyAndReconcileOfflineAuth has already cleared
    // the synthetic session if the refresh token was revoked.
    const next = deriveCurrentState();
    transition({
      to: next.state,
      reason: 'reconcile:failed',
      userId: next.userId,
      email: next.email,
    });
    return false;
  });
}
