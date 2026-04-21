import { supabase } from "@/integrations/supabase/client";
import { assertSafeToDeleteChildRows } from "./child-row-deletion-tripwire";

/**
 * Reconcile child table rows: delete server rows not present locally,
 * then log the deletions for audit/recovery.
 * 
 * This is the core fix for "deleted rows reappear after sync".
 * The approach: compare server IDs with local IDs, delete the difference,
 * and log deleted rows to report_deleted_items for recovery.
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

/**
 * Delete server-side child rows that are no longer present in the local state,
 * and log them to report_deleted_items for audit/recovery.
 * 
 * Returns the rollback data (deleted rows) in case the caller needs to undo.
 */
export async function reconcileChildTable({
  childTable,
  parentIdColumn,
  parentId,
  localItems,
  reportType,
  userId,
  prefetchedServerRows,
}: ReconcileOptions): Promise<{ deletedCount: number; deletedRows: any[] }> {
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
      return { deletedCount: 0, deletedRows: [] };
    }
    serverRows = data || [];
  }

  if (serverRows.length === 0) {
    return { deletedCount: 0, deletedRows: [] };
  }

  // 2. Build set of local IDs (only real UUIDs, not temp-)
  const localIdSet = new Set(
    localItems
      .map(item => item.id)
      .filter((id): id is string => !!id && !id.startsWith('temp-'))
  );

  // 3. Partial-read detection: if local has < 50% of server rows, skip reconciliation
  const localCount = localItems.filter(i => i.id && !i.id.startsWith('temp-')).length;
  const serverCount = serverRows.length;

  // V3: Defer reconciliation if parent was just touched by another device.
  // If server has more rows than local AND local count is small (likely partial read or
  // foreign-device window), preserve server data rather than auto-prune.
  if (serverCount > 2 && localCount > 0 && localCount < serverCount * 0.5) {
    console.warn(`[Reconcile] BLOCKED: ${childTable} local has ${localCount}/${serverCount} rows -- possible partial read or foreign-device sync window, preserving server data`);
    return { deletedCount: 0, deletedRows: [] };
  }

  // V3 extra guard: if local has zero non-temp items but server has data, never prune.
  // This prevents wiping a freshly-loaded device that hasn't yet rendered local children.
  if (localCount === 0 && serverCount > 0) {
    console.warn(`[Reconcile] BLOCKED: ${childTable} local has 0 items but server has ${serverCount} -- preserving server data`);
    return { deletedCount: 0, deletedRows: [] };
  }

  // 4. Find server rows not in local state (these were deleted by user)
  const rowsToDelete = serverRows.filter((row: any) => !localIdSet.has(row.id));

  if (rowsToDelete.length === 0) {
    return { deletedCount: 0, deletedRows: [] };
  }

  console.log(`[Reconcile] ${childTable}: ${rowsToDelete.length} rows to delete for ${parentId.substring(0, 8)}...`);

  // 4. Delete the rows from server
  const idsToDelete = rowsToDelete.map((r: any) => r.id);
  const { error: deleteError } = await (supabase as any)
    .from(childTable)
    .delete()
    .in('id', idsToDelete);

  if (deleteError) {
    console.error(`[Reconcile] Failed to delete from ${childTable}:`, deleteError);
    return { deletedCount: 0, deletedRows: [] };
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

  return { deletedCount: rowsToDelete.length, deletedRows: rowsToDelete };
}

/**
 * Reconcile multiple child tables for a report in parallel.
 * Returns total count of deleted rows across all tables.
 */
export async function reconcileAllChildTables(
  tables: Array<{
    childTable: string;
    parentIdColumn: string;
    localItems: Array<{ id?: string }>;
    prefetchedServerRows?: any[];
  }>,
  parentId: string,
  reportType: 'inspection' | 'training' | 'daily_assessment',
  userId: string,
): Promise<number> {
  const results = await Promise.all(
    tables.map(t => reconcileChildTable({
      childTable: t.childTable,
      parentIdColumn: t.parentIdColumn,
      parentId,
      localItems: t.localItems,
      reportType,
      userId,
      prefetchedServerRows: t.prefetchedServerRows,
    }))
  );

  const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0);
  
  if (totalDeleted > 0) {
    console.log(`[Reconcile] Total ${totalDeleted} orphaned rows deleted for ${reportType} ${parentId.substring(0, 8)}...`);
  }

  return totalDeleted;
}
