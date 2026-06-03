/**
 * Slice 5B — Non-redirecting role status hook.
 *
 * Returns `{ isAdmin, loading }` from the same RBAC source as
 * `useRequireAdmin` (the `is_admin_or_above` SECURITY DEFINER RPC) but
 * NEVER redirects, NEVER blocks render, NEVER throws. Used by panels
 * that must stay accessible to regular users (e.g. UserDataRecoverySheet)
 * while still letting admin-only branches (locked-report restore override)
 * detect admin status.
 *
 * Failure mode: when the role lookup is unavailable (offline cold start,
 * missing session, network error), returns `{ isAdmin: false, loading: false }`.
 * This is intentionally fail-closed for admin override capability — never
 * silently grant admin override on missing role info — and is intentionally
 * NOT fail-closed for opening the recovery surface, which does not call
 * this hook for visibility gating.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getUserWithCache, getOfflineUserId, getAdminCacheKey } from '@/lib/cached-auth';
import { safeSetItem } from '@/lib/safe-local-storage';

export interface RoleStatus {
  isAdmin: boolean;
  loading: boolean;
}

export function useRoleStatus(): RoleStatus {
  const [state, setState] = useState<RoleStatus>({ isAdmin: false, loading: true });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const user = await getUserWithCache();
        const userId = user?.id ?? getOfflineUserId() ?? null;

        // No session at all → fail-closed for admin override, do not redirect.
        if (!user) {
          // Honor cached admin status only when we can locate a user id.
          if (userId) {
            try {
              const cached = localStorage.getItem(getAdminCacheKey(userId));
              if (!cancelled) {
                setState({ isAdmin: cached === 'true', loading: false });
                return;
              }
            } catch {
              /* localStorage unavailable; fall through to fail-closed */
            }
          }
          if (!cancelled) setState({ isAdmin: false, loading: false });
          return;
        }

        try {
          const { data, error } = await supabase.rpc('is_admin_or_above');
          if (error) throw error;
          const hasAccess = !!data;
          if (userId) {
            safeSetItem(getAdminCacheKey(userId), hasAccess.toString(), {
              scope: 'useRoleStatus.cache',
            });
          }
          if (!cancelled) setState({ isAdmin: hasAccess, loading: false });
        } catch {
          // Network / RPC failure → fall back to cached value.
          let cached: string | null = null;
          if (userId) {
            try {
              cached = localStorage.getItem(getAdminCacheKey(userId));
            } catch {
              /* ignore */
            }
          }
          if (!cancelled) {
            setState({ isAdmin: cached === 'true', loading: false });
          }
        }
      } catch {
        if (!cancelled) setState({ isAdmin: false, loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
