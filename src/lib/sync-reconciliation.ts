import { supabase } from "@/integrations/supabase/client";
import { assertSafeToDeleteChildRows } from "./child-row-deletion-tripwire";

/**
 * Reconcile child table rows: delete server rows not present locally,
 * then log the deletions for audit/recovery.
 *
 * The approach: compare server IDs with local IDs, delete the difference,
 * and log deleted rows to report_deleted_items for recovery.
 *
 * Returns a structured status so callers can refuse to mark the parent
 * synced when reconcile was blocked by a safety guard.
 */

interface ReconcileOptions {
  childTable: string;
  parentIdColumn: string; // e.g. 'inspection_id', 'training_id', 'assessment_id'
  parentId: string;
  localItems: Array<{ id?: string }>;
  reportType: 'inspection' | 'training' | 'daily_assessment';
  userId: string;
  prefetchedServerRows?: any[]; // Pre-fetched server rows from Guard 1 to avoid duplicate fetch
  /**
   * V5 guard: caller signals it had a successful (non-fallback) IndexedDB read
   * for `localItems`. When false and localItems is empty, we never prune.
   */
  expectedNonEmpty?: boolean;
}

export interface ReconcileResult {
  deletedCount: number;
  deletedRows: any[];
  /** True when a safety guard or the final tripwire refused to perform the planned delete. */
  blocked: boolean;
  /** Short machine-readable reason when `blocked === true`. */
  blockReason?: string;
}

/**
 * Delete server-side child rows that are no longer present in the local state,
 * and log them to report_deleted_items for audit/recovery.
 */
export async function reconcileChildTable({
  childTable,
  parentIdColumn,
  parentId,
  localItems,
  reportType,
  userId,
  prefetchedServerRows,
  expectedNonEmpty,
}: ReconcileOptions): Promise<ReconcileResult> {
  // 1. Use pre-fetched rows if available, otherwise fetch from server
  let serverRows: any[];
  if (prefetchedServerRows !== undefined) {
    serverRows = prefetchedServerRows;
  } else {
    const { data, error: fetchError } = await (supabase as any)
      .from(childTable)
      .select('*')
      .eq(parentIdColumn, parentId);

    if (fetchError) {
      console.error(`[Reconcile] Failed to fetch ${childTable}:`, fetchError);
      return { deletedCount: 0, deletedRows: [], blocked: true, blockReason: 'fetch_failed' };
    }
    serverRows = data || [];
  }

  if (serverRows.length === 0) {
    return { deletedCount: 0, deletedRows: [], blocked: false };
  }

  // 2. Build set of local IDs (only real UUIDs, not temp-)
  const localIdSet = new Set(
    localItems
      .map(item => item.id)
      .filter((id): id is string => !!id && !id.startsWith('temp-'))
  );

  const localCount = localItems.filter(i => i.id && !i.id.startsWith('temp-')).length;
  const serverCount = serverRows.length;

  // GUARD A: If the caller couldn't confirm a successful IDB read AND local is empty,
  // never prune — this is almost certainly a fallback / timeout, not user intent.
  if (expectedNonEmpty === false && localCount === 0) {
    console.warn(`[Reconcile] BLOCKED: ${childTable} local IDB read failed and local is empty -- preserving server data`);
    return { deletedCount: 0, deletedRows: [], blocked: true, blockReason: 'local_read_failed_and_empty' };
  }

  // GUARD B: Local has zero non-temp items but server has data, AND we don't have
  // an explicit confirmation that the read succeeded. Treat as suspicious empty.
  // When expectedNonEmpty === true, the caller is explicitly saying "I read it,
  // user emptied this section" — honor that and let the delete proceed.
  if (expectedNonEmpty !== true && localCount === 0 && serverCount > 0) {
    console.warn(`[Reconcile] BLOCKED: ${childTable} local empty but server has ${serverCount}; read status unknown -- preserving server data`);
    return { deletedCount: 0, deletedRows: [], blocked: true, blockReason: 'local_empty_unconfirmed' };
  }

  // (Removed: V4 50% rule and V4 absolute-delta-of-3 rule.
  //  Both blocked legitimate user deletions and were causing "deleted rows reappear".
  //  The final tripwire below + per-read expectedNonEmpty flag now provide safety.)

  // 3. Find server rows not in local state (these were deleted by user)
  const rowsToDelete = serverRows.filter((row: any) => !localIdSet.has(row.id));

  if (rowsToDelete.length === 0) {
    return { deletedCount: 0, deletedRows: [], blocked: false };
  }

  console.log(`[Reconcile] ${childTable}: ${rowsToDelete.length} rows to delete for ${parentId.substring(0, 8)}...`);

  // 4. Delete the rows from server
  const idsToDelete = rowsToDelete.map((r: any) => r.id);

  // FINAL TRIPWIRE: re-fetch live count, refuse if >70% would be wiped
  const tripwire = await assertSafeToDeleteChildRows({
    table: childTable,
    parentFkColumn: parentIdColumn,
    parentId,
    idsToDelete,
    context: { source: 'reconcileChildTable', reportType, userId },
  });
  if (!tripwire.allowed) {
    return { deletedCount: 0, deletedRows: [], blocked: true, blockReason: 'tripwire_refused' };
  }

  const { error: deleteError } = await (supabase as any)
    .from(childTable)
    .delete()
    .in('id', idsToDelete);

  if (deleteError) {
    console.error(`[Reconcile] Failed to delete from ${childTable}:`, deleteError);
    return { deletedCount: 0, deletedRows: [], blocked: true, blockReason: 'delete_error' };
  }

  // 5. Log deletions to audit table (fire-and-forget, don't block sync)
  try {
    const auditRows = rowsToDelete.map((row: any) => ({
      report_type: reportType,
      report_id: parentId,
      child_table: childTable,
      deleted_item_id: row.id,
      deleted_item_data: row,
      deleted_by: userId,
    }));

    // Insert in batches of 50 to avoid payload limits
    for (let i = 0; i < auditRows.length; i += 50) {
      const batch = auditRows.slice(i, i + 50);
      await supabase.from('report_deleted_items' as any).insert(batch);
    }
  } catch (auditError) {
    // Non-fatal: audit logging failure shouldn't block sync
    console.warn(`[Reconcile] Audit logging failed for ${childTable}:`, auditError);
  }

  return { deletedCount: rowsToDelete.length, deletedRows: rowsToDelete, blocked: false };
}

export interface ReconcileAllResult {
  totalDeleted: number;
  blocked: boolean;
  blockedTables: Array<{ table: string; reason: string }>;
}

/**
 * Reconcile multiple child tables for a report in parallel.
 * Returns total count of deleted rows across all tables AND whether any
 * table's reconciliation was blocked by a safety guard.
 */
export async function reconcileAllChildTables(
  tables: Array<{
    childTable: string;
    parentIdColumn: string;
    localItems: Array<{ id?: string }>;
    prefetchedServerRows?: any[];
    expectedNonEmpty?: boolean;
  }>,
  parentId: string,
  reportType: 'inspection' | 'training' | 'daily_assessment',
  userId: string,
): Promise<ReconcileAllResult> {
  // S26: Use allSettled so a single thrown table doesn't take down the batch.
  // Rejections are surfaced via blockedTables so the caller's existing
  // `blocked === true` short-circuit triggers a retry on the next sync cycle.
  const settled = await Promise.allSettled(
    tables.map((t) =>
      reconcileChildTable({
        childTable: t.childTable,
        parentIdColumn: t.parentIdColumn,
        parentId,
        localItems: t.localItems,
        reportType,
        userId,
        prefetchedServerRows: t.prefetchedServerRows,
        expectedNonEmpty: t.expectedNonEmpty,
      }).then((result) => ({ table: t.childTable, result }))
    )
  );

  const results = settled.map((s, idx) => {
    if (s.status === 'fulfilled') return s.value;
    const tableName = tables[idx].childTable;
    const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
    console.error(`[Reconcile] Table ${tableName} threw:`, s.reason);
    return {
      table: tableName,
      result: {
        deletedCount: 0,
        deletedRows: [],
        blocked: true,
        blockReason: `reconcile_threw: ${reason}`,
      } as ReconcileResult,
    };
  });

  const totalDeleted = results.reduce((sum, r) => sum + r.result.deletedCount, 0);
  const blockedTables = results
    .filter(r => r.result.blocked)
    .map(r => ({ table: r.table, reason: r.result.blockReason || 'unknown' }));

  if (totalDeleted > 0) {
    console.log(`[Reconcile] Total ${totalDeleted} orphaned rows deleted for ${reportType} ${parentId.substring(0, 8)}...`);
  }
  if (blockedTables.length > 0) {
    console.warn(`[Reconcile] ${blockedTables.length} table(s) blocked for ${reportType} ${parentId.substring(0, 8)}:`, blockedTables);
  }

  return {
    totalDeleted,
    blocked: blockedTables.length > 0,
    blockedTables,
  };
}
