/**
 * Deferred Child-Row Reconciliation (H3)
 * ──────────────────────────────────────
 * Originally `reconcileAllChildTables` ran BEFORE the upsert transaction:
 *
 *   1. reconcile children — DELETE server rows not in local
 *   2. upsert parent + children
 *   3. on step-2 failure, only the upserts roll back; step-1 deletions persist
 *
 * That left a window where a transient transaction failure permanently lost
 * server child rows the user had not actually intended to delete (the local
 * read might have been stale or partial). C4 introduced `restoreReconciledDeletions`
 * as compensating recovery, but compensation runs against the same flaky
 * network that just failed the upsert — so it can leave the server in a
 * half-deleted state.
 *
 * H3 fix: reorder to upsert-first, reconcile-second.
 *
 *   1. upsert parent + current children (transactional)
 *   2. on success, reconcile: DELETE any server rows NOT in the upserted set
 *
 * Properties:
 *   - On step-1 (upsert) failure: nothing was deleted. Local data unchanged.
 *     Next sync retries the same upsert. Safe.
 *   - On step-2 (reconcile) failure: parent+children are already on server,
 *     so there are extra server rows that should have been deleted. Worst-case
 *     UI behavior: a deleted item reappears once on next remote pull. Next
 *     sync runs the deferred reconcile again and removes it. Safe and
 *     self-healing.
 *   - The 70%-tripwire and per-table guards still fire inside reconcileChildTable;
 *     they were always safety nets independent of ordering.
 *
 * Trade-off: server briefly contains extra child rows during the
 * upsert→reconcile window (typically 100-500ms). For a single-user-per-record
 * model that's invisible; for the rare concurrent-edit case the merge layer
 * already resolves it on the next pull.
 */

import { reconcileAllChildTables, type ReconcileAllResult } from "./sync-reconciliation";
import { syncLog } from "./sync-logger";

export interface DeferredReconcileSpec {
  childTable: string;
  parentIdColumn: string;
  localItems: Array<{ id?: string }>;
  prefetchedServerRows?: Array<{ id?: string }>;
  expectedNonEmpty?: boolean;
}

export interface DeferredReconcileOutcome {
  ran: boolean;
  result?: ReconcileAllResult;
  error?: Error;
}

/**
 * Run reconcile AFTER the upsert transaction has committed. Never throws —
 * a thrown reconcile would leave the caller thinking sync failed when in
 * fact parent+children are safe on the server.
 *
 * Caller MUST inspect `outcome.result?.blocked` and surface a "retry on next
 * sync" status when true so the user's unflushed deletions are not silently
 * dropped from the unsynced count.
 */
export async function runDeferredReconcile(
  tables: DeferredReconcileSpec[],
  parentId: string,
  reportType: 'inspection' | 'training' | 'daily_assessment',
  userId: string,
): Promise<DeferredReconcileOutcome> {
  try {
    const result = await reconcileAllChildTables(tables, parentId, reportType, userId);
    if (result.blocked) {
      syncLog.log('[H3] Deferred reconcile blocked — will retry on next sync cycle', {
        reportType,
        parentId: parentId.substring(0, 8),
        blockedTables: result.blockedTables,
      });
    } else if (result.totalDeleted > 0) {
      syncLog.log('[H3] Deferred reconcile removed orphaned server rows', {
        reportType,
        parentId: parentId.substring(0, 8),
        totalDeleted: result.totalDeleted,
      });
    }
    return { ran: true, result };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error('[H3] Deferred reconcile threw — server may have stale child rows; next sync will retry', {
      reportType,
      parentId: parentId.substring(0, 8),
      error: err.message,
    });
    return { ran: false, error: err };
  }
}
