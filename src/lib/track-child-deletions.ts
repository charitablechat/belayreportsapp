/**
 * Child-row deletion tracker.
 *
 * Wraps a React setter so that whenever the parent form component receives
 * a state update from a child table's UI (e.g. the user clicked a row's
 * delete button and the table called `onUpdate(prev => prev.filter(...))`),
 * we record the removed non-`temp-*` ids into a session-scoped Set.
 *
 * Those ids are then passed to `mergeChildArray` on the next reconcile so a
 * stale server snapshot can't resurrect a row the user just deleted.
 *
 * Contract notes (important — see SCOPE comments below):
 *  - Only intentional UI-driven deletions go through this wrapper. The
 *    parent must NOT route programmatic reconciles, server fetches, JSON
 *    import resets, or any wholesale state replacement through the wrapped
 *    setter — those call the raw `setX` directly so they never inflate the
 *    deletion set.
 *  - Only functional updates (`prev => next`) are tracked. Value-form
 *    updates `setter(arrayLiteral)` are forwarded unchanged WITHOUT diffing,
 *    so callers that legitimately need to replace state can do so via the
 *    raw setter or by passing a value (not a function) — but in practice
 *    every Inspection/Training child table uses functional updates for both
 *    add and remove, so the wrapper covers every UI deletion path.
 *  - `temp-*` ids are intentionally ignored: a temp row was never on the
 *    server, so there's no server snapshot that could resurrect it.
 */

import type { Dispatch, SetStateAction, MutableRefObject } from 'react';

interface HasId {
  id?: string | null;
}

/**
 * Wrap a `useState` setter so removed non-temp ids land in
 * `deletedIdsRef.current`. Returns a setter with the same signature as the
 * input so it's a drop-in replacement for the `onUpdate` prop passed to the
 * child table component.
 */
export function trackChildDeletions<T extends HasId>(
  setter: Dispatch<SetStateAction<T[]>>,
  deletedIdsRef: MutableRefObject<Set<string>>,
): Dispatch<SetStateAction<T[]>> {
  return (action: SetStateAction<T[]>) => {
    if (typeof action !== 'function') {
      // Non-functional update: the caller passed a literal array. We can't
      // tell what was removed without the previous value, and this path is
      // not how the inspection/training tables remove rows. Forward as-is.
      setter(action);
      return;
    }
    setter((prev: T[]) => {
      const next = (action as (p: T[]) => T[])(prev);
      try {
        if (Array.isArray(prev) && Array.isArray(next) && next.length < prev.length) {
          const nextIds = new Set(next.map(r => r.id).filter((id): id is string => !!id));
          for (const row of prev) {
            const id = row.id;
            if (!id) continue;
            if (id.startsWith('temp-')) continue; // local-only row — nothing to suppress
            if (!nextIds.has(id)) {
              deletedIdsRef.current.add(id);
            }
          }
        }
      } catch {
        // Tracking is best-effort; never break the state update.
      }
      return next;
    });
  };
}
