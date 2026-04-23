/**
 * Clear-intent helpers — disambiguate "user intentionally emptied this report"
 * from "IndexedDB read returned nothing because of corruption / stale cache".
 *
 * The empty-local guard in atomic-sync-manager.ts uses `user_cleared_at` on the
 * parent record (inspections / trainings / daily_assessments) to honor a
 * deliberate clear instead of restoring the server copy back into IDB.
 *
 * Stamp the marker when the user removes the LAST child row across all sections
 * of a previously-synced report. Reset it the moment any section regains
 * content, so a future stale read can't be misinterpreted.
 */

interface ClearIntentParent {
  user_cleared_at?: string | null;
  updated_at?: string;
  synced_at?: string | null;
}

/**
 * Stamp the parent with `user_cleared_at = now()` and bump `updated_at`.
 * Returns a NEW object (does not mutate input).
 */
export function markUserCleared<T extends ClearIntentParent>(parent: T): T {
  const now = new Date().toISOString();
  return { ...parent, user_cleared_at: now, updated_at: now };
}

/**
 * Clear the marker once the user adds content back. Returns a NEW object.
 * Only modifies updated_at if the marker was actually present, so this is safe
 * to call on every save without spurious version bumps.
 */
export function clearUserClearedMarker<T extends ClearIntentParent>(parent: T): T {
  if (!parent.user_cleared_at) return parent;
  return { ...parent, user_cleared_at: null, updated_at: new Date().toISOString() };
}

/**
 * Decide whether to stamp / clear / leave-alone given the latest section counts.
 *
 * - If parent was previously synced AND every section is now empty → stamp.
 * - If marker is currently set AND any section has content → clear.
 * - Otherwise return parent unchanged.
 *
 * `totalChildCount` is the sum of every section's row count (including the
 * summary row if present). `wasPreviouslySynced` is `!!parent.synced_at`.
 */
export function reconcileClearIntent<T extends ClearIntentParent>(
  parent: T,
  totalChildCount: number,
  wasPreviouslySynced: boolean,
): T {
  const isEmpty = totalChildCount === 0;
  if (isEmpty && wasPreviouslySynced && !parent.user_cleared_at) {
    return markUserCleared(parent);
  }
  if (!isEmpty && parent.user_cleared_at) {
    return clearUserClearedMarker(parent);
  }
  return parent;
}

/**
 * Did the user clear this record AFTER its last successful sync?
 * Used by atomic-sync-manager to honor intentional clears.
 */
export function wasClearedAfterLastSync(parent: ClearIntentParent): boolean {
  if (!parent.user_cleared_at || !parent.synced_at) return false;
  return new Date(parent.user_cleared_at).getTime() >= new Date(parent.synced_at).getTime();
}
