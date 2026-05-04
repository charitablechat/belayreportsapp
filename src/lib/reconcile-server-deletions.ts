/**
 * Reconcile local IndexedDB cache against the authoritative server response.
 *
 * Background: Dashboard load uses stale-while-revalidate (cache → render →
 * fetch → render again). Server rows that were soft-deleted from another
 * device are not in the network response, but the local cache still holds
 * them — so the count flickers between cached (e.g. 51) and authoritative
 * (e.g. 44) on every reload, and stays stale offline.
 *
 * Fix: After a successful network fetch, find local rows the server
 * omitted and quarantine them with `_remote_deleted_at`. The existing
 * `isNotQuarantined` filter (used by every dashboard reader and every
 * getUnsynced* call) immediately drops them, while the existing 30-day
 * quarantine GC sweeps them later.
 *
 * Safety: never quarantine local-only / dirty / unsynced rows — those are
 * unsaved user work that the sync pipeline still owns.
 */

import { quarantineRecord, type QuarantineTable } from "./offline-storage";

interface ReconcileRow {
  id?: string;
  inspector_id?: string | null;
  synced_at?: string | null;
  dirty?: boolean;
  _remote_deleted_at?: string | null;
}

interface ReconcileOptions {
  table: QuarantineTable;
  /** Rows currently in IndexedDB (already filtered to active, unquarantined). */
  localRows: ReconcileRow[];
  /** Rows the server returned for this user/scope on this fetch. */
  serverRows: ReconcileRow[];
  /** Current user id. Used to scope the diff for non-super-admins. */
  userId?: string | null;
  /** When true, all server rows are visible to this user — diff covers all locals. */
  isSuperAdmin?: boolean;
}

export async function reconcileServerDeletions(opts: ReconcileOptions): Promise<number> {
  const { table, localRows, serverRows, userId, isSuperAdmin } = opts;

  // Hard guard: only run when the network actually returned something.
  // An empty/failed response must never be treated as "everything was deleted".
  if (!Array.isArray(serverRows) || serverRows.length === 0) return 0;
  if (!Array.isArray(localRows) || localRows.length === 0) return 0;

  const serverIds = new Set(serverRows.map((r) => r.id));

  let quarantined = 0;
  const quarantineAt = new Date().toISOString();

  for (const row of localRows) {
    if (!row?.id) continue;
    if (serverIds.has(row.id)) continue;
    // Skip already-quarantined rows.
    if (row._remote_deleted_at) continue;
    // Never touch unsynced local edits — temp ids, dirty flag, or no synced_at.
    if (row.id.startsWith("temp-")) continue;
    if (row.dirty === true) continue;
    if (!row.synced_at) continue;
    // Scope filter: a regular user's server query is filtered to
    // inspector_id = self. Don't quarantine rows owned by other users
    // on a shared device — they are simply out of scope for this query.
    if (!isSuperAdmin && userId && row.inspector_id && row.inspector_id !== userId) continue;

    const ok = await quarantineRecord(table, row.id, quarantineAt, "missing_from_server");
    if (ok) {
      quarantined += 1;
      if (import.meta.env.DEV) {
        console.log(`[reconcile] Quarantined ${table} ${row.id} — missing from server response`);
      }
    }
  }

  return quarantined;
}
