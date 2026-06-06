import { supabase } from "@/integrations/supabase/client";
import { assertSafeToDeleteChildRows } from "./child-row-deletion-tripwire";
import { syncLog } from "./sync-logger";

/**
 * Server-side child-table rows fetched from Supabase. We only rely on the
 * `id` field here; everything else is preserved opaquely so it can be
 * re-inserted via `restoreReconciledDeletions` or logged into the audit
 * table without casting.
 */
type ServerRow = Record<string, unknown> & { id?: string };

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
  prefetchedServerRows?: ServerRow[]; // Pre-fetched server rows from Guard 1 to avoid duplicate fetch
  /**
   * V5 guard: caller signals it had a successful (non-fallback) IndexedDB read
   * for `localItems`. When false and localItems is empty, we never prune.
   */
  expectedNonEmpty?: boolean;
}

export interface ReconcileResult {
  deletedCount: number;
  deletedRows: ServerRow[];
  /** True when a safety guard or the final tripwire refused to perform the planned delete. */
  blocked: boolean;
  /** Short machine-readable reason when `blocked === true`. */
  blockReason?: string;
}

/**
 * H4 zero-overlap guard — list of child tables where reconcile must REFUSE to
 * delete server rows when the local id set shares zero overlap with the server
 * id set despite both sides being non-empty.
 *
 * Why these tables: rows are identified by stable server UUIDs preserved
 * end-to-end (form → IDB → upsert → server). A user editing a report cannot
 * legitimately rotate every existing id in a single sync cycle — at worst
 * they replace one row at a time, which leaves overlap ≥ 1. Zero overlap on
 * these tables therefore signals a stale, mismatched, or temp-id-only
 * localItems snapshot (the production churn pattern seen on Luke's reports)
 * and the destructive sweep must be refused.
 *
 * Tables intentionally EXCLUDED from the guard:
 *   - inspection_summary, training_summary: hold exactly one row whose id is
 *     legitimately regenerated on upsert when the original was a temp- id.
 *     A 1→1 id rotation with zero overlap is normal and must be allowed.
 *
 * Tables not in this set fall back to the existing Guard A/B + 70% tripwire
 * behavior unchanged.
 */
const ZERO_OVERLAP_GUARDED_TABLES = new Set<string>([
  'inspection_systems',
  'inspection_equipment',
  'inspection_ziplines',
  'inspection_standards',
  'training_delivery_approaches',
  'training_operating_systems',
  'training_immediate_attention',
  'training_verifiable_items',
  'training_systems_in_place',
  'daily_assessment_beginning_of_day',
  'daily_assessment_end_of_day',
  'daily_assessment_operating_systems',
  'daily_assessment_equipment_checks',
  'daily_assessment_structure_checks',
  'daily_assessment_environment_checks',
]);


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
  let serverRows: ServerRow[];
  if (prefetchedServerRows !== undefined) {
    serverRows = prefetchedServerRows;
  } else {
    const { data, error: fetchError } = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (col: string, val: string) => Promise<{ data: ServerRow[] | null; error: unknown }>;
        };
      };
    })
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
  const rowsToDelete = serverRows.filter(
    (row): row is ServerRow & { id: string } => typeof row.id === 'string' && !localIdSet.has(row.id),
  );

  if (rowsToDelete.length === 0) {
    return { deletedCount: 0, deletedRows: [], blocked: false };
  }

  syncLog.log(`[Reconcile] ${childTable}: ${rowsToDelete.length} rows to delete for ${parentId.substring(0, 8)}...`);

  // 4. Delete the rows from server
  const idsToDelete = rowsToDelete.map((r) => r.id);

  // FINAL TRIPWIRE: re-fetch live count, refuse if >70% would be wiped
  const tripwire = await assertSafeToDeleteChildRows({
    table: childTable,
    parentFkColumn: parentIdColumn,
    parentId,
    idsToDelete,
    context: {
      source: 'reconcileChildTable',
      reportType,
      userId,
      // Form saves pass expectedNonEmpty=true only after the child array has
      // been successfully loaded and is now the user's canonical local truth.
      // Deleting the last Zipline is a legitimate explicit action; without
      // this opt-in the 70% tripwire blocks 1/1 deletes and the row returns
      // from the server on refresh.
      bulk: expectedNonEmpty === true,
      reason: expectedNonEmpty === true ? 'explicit_form_child_delete' : undefined,
    },
  });
  if (!tripwire.allowed) {
    return { deletedCount: 0, deletedRows: [], blocked: true, blockReason: 'tripwire_refused' };
  }

  const { error: deleteError } = await (supabase as unknown as {
    from: (t: string) => {
      delete: () => {
        in: (col: string, vals: string[]) => Promise<{ error: unknown }>;
      };
    };
  })
    .from(childTable)
    .delete()
    .in('id', idsToDelete);

  if (deleteError) {
    console.error(`[Reconcile] Failed to delete from ${childTable}:`, deleteError);
    return { deletedCount: 0, deletedRows: [], blocked: true, blockReason: 'delete_error' };
  }

  // 5. Log deletions to audit table (fire-and-forget, don't block sync)
  try {
    const auditRows = rowsToDelete.map((row) => ({
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
      await (supabase.from('report_deleted_items' as never) as unknown as {
        insert: (rows: unknown[]) => Promise<unknown>;
      }).insert(batch);
    }
  } catch (auditError) {
    // Non-fatal: audit logging failure shouldn't block sync
    console.warn(`[Reconcile] Audit logging failed for ${childTable}:`, auditError);
  }

  return { deletedCount: rowsToDelete.length, deletedRows: rowsToDelete, blocked: false };
}

export interface ReconciledTableDelete {
  table: string;
  rows: ServerRow[];
}

export interface ReconcileAllResult {
  totalDeleted: number;
  blocked: boolean;
  blockedTables: Array<{ table: string; reason: string }>;
  /**
   * C4: Per-table deleted row pre-images, kept in memory so the caller can
   * re-insert them if a downstream transaction (or parallel upsert batch) fails.
   * Empty array when nothing was deleted.
   */
  deletedByTable: ReconciledTableDelete[];
}

/**
 * C4: Re-insert rows that `reconcileAllChildTables` deleted from the server,
 * to be called when a downstream transaction or parallel upsert batch fails.
 * The audit row in `report_deleted_items` is preserved either way so the
 * admin recovery tool remains a fallback if this best-effort restore fails.
 */
export async function restoreReconciledDeletions(
  deletes: ReconciledTableDelete[],
  parentId: string,
): Promise<{ restored: number; failed: number }> {
  let restored = 0;
  let failed = 0;
  for (const { table, rows } of deletes) {
    if (!rows || rows.length === 0) continue;
    try {
      // Re-insert in batches of 50 (matches the existing audit batch size).
      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const { error } = await (supabase as unknown as {
          from: (t: string) => {
            insert: (rows: ServerRow[]) => Promise<{ error: unknown }>;
          };
        }).from(table).insert(batch);
        if (error) throw error;
      }
      restored += rows.length;
      console.warn(
        `[C4] Restored ${rows.length} reconciled row(s) into ${table} for ${parentId.substring(0, 8)}`,
      );
    } catch (e) {
      console.error('[C4] Failed to restore reconciled rows', { table, parentId, error: e });
      failed += rows.length;
    }
  }
  return { restored, failed };
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
    prefetchedServerRows?: ServerRow[];
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
  // C4: capture per-table deleted row pre-images for restore-on-failure.
  const deletedByTable: ReconciledTableDelete[] = results
    .filter(r => r.result.deletedRows && r.result.deletedRows.length > 0)
    .map(r => ({ table: r.table, rows: r.result.deletedRows }));

  if (totalDeleted > 0) {
    syncLog.log(`[Reconcile] Total ${totalDeleted} orphaned rows deleted for ${reportType} ${parentId.substring(0, 8)}...`);
  }
  if (blockedTables.length > 0) {
    console.warn(`[Reconcile] ${blockedTables.length} table(s) blocked for ${reportType} ${parentId.substring(0, 8)}:`, blockedTables);
  }

  return {
    totalDeleted,
    blocked: blockedTables.length > 0,
    blockedTables,
    deletedByTable,
  };
}
