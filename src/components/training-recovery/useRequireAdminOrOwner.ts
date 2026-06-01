import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getUserWithCache } from '@/lib/cached-auth';

type AccessResult =
  | { status: 'loading' }
  | { status: 'denied' }
  | { status: 'allowed'; isAdmin: boolean; ownedTrainingIds: Set<string> };

/**
 * Read-only access gate for the Training Recovery page.
 *
 * Allow when:
 *  - the user is admin/super_admin (is_admin_or_above RPC), OR
 *  - the user owns at least one of the pinned training_ids
 *    (trainings.user_id === auth.uid()).
 *
 * Otherwise deny. No writes.
 */
export function useRequireAdminOrOwner(pinnedTrainingIds: readonly string[]): AccessResult {
  const [result, setResult] = useState<AccessResult>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const user = await getUserWithCache();
        if (!user?.id) {
          if (!cancelled) setResult({ status: 'denied' });
          return;
        }

        // Admin check (RLS-friendly, read-only RPC).
        let isAdmin = false;
        try {
          const { data } = await supabase.rpc('is_admin_or_above');
          isAdmin = !!data;
        } catch {
          isAdmin = false;
        }

        // Owner check — read-only SELECT, RLS-scoped to rows the user can see.
        const ownedTrainingIds = new Set<string>();
        try {
          const { data } = await supabase
            .from('trainings')
            .select('id, user_id')
            .in('id', pinnedTrainingIds as string[]);
          if (Array.isArray(data)) {
            for (const row of data as Array<{ id?: string; user_id?: string }>) {
              if (row?.id && row.user_id === user.id) {
                ownedTrainingIds.add(row.id);
              }
            }
          }
        } catch {
          // If the lookup fails (offline / RLS), owner set stays empty.
        }

        if (cancelled) return;

        if (isAdmin || ownedTrainingIds.size > 0) {
          setResult({ status: 'allowed', isAdmin, ownedTrainingIds });
        } else {
          setResult({ status: 'denied' });
        }
      } catch {
        if (!cancelled) setResult({ status: 'denied' });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedTrainingIds.join('|')]);

  return result;
}
