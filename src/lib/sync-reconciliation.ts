import { supabase } from "@/integrations/supabase/client";

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
}: ReconcileOptions): Promise<{ deletedCount: number; deletedRows: any[] }> {
  // 1. Fetch current server rows for this parent
  const { data: serverRows, error: fetchError } = await (supabase as any)
    .from(childTable)
    .select('*')
    .eq(parentIdColumn, parentId);

  if (fetchError) {
    console.error(`[Reconcile] Failed to fetch ${childTable}:`, fetchError);
    return { deletedCount: 0, deletedRows: [] };
  }

  if (!serverRows || serverRows.length === 0) {
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

  if (serverCount > 2 && localCount > 0 && localCount < serverCount * 0.5) {
    console.warn(`[Reconcile] BLOCKED: ${childTable} local has ${localCount}/${serverCount} rows -- possible partial read, preserving server data`);
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
    }))
  );

  const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0);
  
  if (totalDeleted > 0) {
    console.log(`[Reconcile] Total ${totalDeleted} orphaned rows deleted for ${reportType} ${parentId.substring(0, 8)}...`);
  }

  return totalDeleted;
}
