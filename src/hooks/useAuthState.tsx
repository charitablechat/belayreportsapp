import { useEffect, useState } from 'react';
import {
  getAuthState,
  subscribeAuthState,
  type AuthSnapshot,
} from '@/lib/auth-state-machine';

/**
 * Phase 2 — React binding for the auth state machine.
 * Returns the current AuthSnapshot and re-renders on every transition.
 */
export function useAuthState(): AuthSnapshot {
  const [snap, setSnap] = useState<AuthSnapshot>(() => getAuthState());

  useEffect(() => {
    const unsub = subscribeAuthState(setSnap);
    return unsub;
  }, []);

  return snap;
}
