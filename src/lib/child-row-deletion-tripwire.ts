/**
 * Child-Row Deletion Tripwire
 *
 * Final safety net before any bulk DELETE on a report child table.
 * Re-fetches the live server count and refuses suspiciously large deletions
 * (>70% of children in one shot) unless the caller explicitly opts in via
 * `context.bulk = true`.
 *
 * Refusals are logged to `report_deleted_items` with `reason: 'tripwire_blocked'`
 * (stored inside `deleted_item_data` JSON) so admins can review activity.
 */

import { supabase } from "@/integrations/supabase/client";

export interface TripwireContext {
  /** Caller name (e.g. 'reconcileChildTable', 'admin_restore', 'transaction_rollback') */
  source: string;
  /** Set true to opt out of the >70% safety check (for legitimate bulk operations) */
  bulk?: boolean;
  /** Optional reason for audit log */
  reason?: string;
  /** Optional user id for audit attribution */
  userId?: string;
  /** Optional report type (informational) */
  reportType?: 'inspection' | 'training' | 'daily_assessment';
}

export interface TripwireResult {
  allowed: boolean;
  reason?: string;
  serverCount?: number;
  attemptedCount?: number;
}

const DESTRUCTIVE_RATIO = 0.7;

/**
 * Validate that a bulk child-row deletion is safe to execute.
 * Caller MUST honor `result.allowed === false` and skip the delete.
 */
export async function assertSafeToDeleteChildRows(params: {
  table: string;
  parentFkColumn: string;
  parentId: string;
  idsToDelete: string[];
  context: TripwireContext;
}): Promise<TripwireResult> {
  const { table, parentFkColumn, parentId, idsToDelete, context } = params;

  if (!idsToDelete || idsToDelete.length === 0) {
    return { allowed: true, attemptedCount: 0 };
  }

  // Re-fetch the live server count for this parent
  let serverCount = 0;
  try {
    const { count, error } = await (supabase as any)
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq(parentFkColumn, parentId);
    if (error) {
      console.warn(`[Tripwire] Count fetch failed for ${table}:`, error.message);
      // Fail-open on count errors (don't block sync due to transient network)
      return { allowed: true, attemptedCount: idsToDelete.length };
    }
    serverCount = count ?? 0;
  } catch (err) {
    console.warn(`[Tripwire] Count fetch threw for ${table}:`, err);
    return { allowed: true, attemptedCount: idsToDelete.length };
  }

  if (serverCount === 0) {
    return { allowed: true, serverCount, attemptedCount: idsToDelete.length };
  }

  const ratio = idsToDelete.length / serverCount;

  if (ratio > DESTRUCTIVE_RATIO && !context.bulk) {
    const reason = `Tripwire blocked: ${idsToDelete.length}/${serverCount} (${(ratio * 100).toFixed(0)}%) of ${table} for parent ${parentId.substring(0, 8)} from ${context.source}`;
    console.error(`[Tripwire] ${reason}`);

    // Fire-and-forget audit log
    try {
      const auditRow: any = {
        report_type: context.reportType || 'inspection',
        report_id: parentId,
        child_table: table,
        deleted_item_id: idsToDelete[0] || 'tripwire_block',
        deleted_item_data: {
          reason: 'tripwire_blocked',
          source: context.source,
          context_reason: context.reason,
          attempted_count: idsToDelete.length,
          server_count: serverCount,
          ratio: Number(ratio.toFixed(3)),
          attempted_ids: idsToDelete.slice(0, 50),
          blocked_at: new Date().toISOString(),
        },
        deleted_by: context.userId ?? null,
      };
      await supabase.from('report_deleted_items' as any).insert(auditRow);
    } catch (logErr) {
      console.warn('[Tripwire] Audit log failed:', logErr);
    }

    return {
      allowed: false,
      reason,
      serverCount,
      attemptedCount: idsToDelete.length,
    };
  }

  return { allowed: true, serverCount, attemptedCount: idsToDelete.length };
}

/**
 * Get count of tripwire blocks in the last `hours` for diagnostic display.
 */
export async function getRecentTripwireBlockCount(hours: number = 24): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const { count, error } = await (supabase as any)
      .from('report_deleted_items')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', cutoff)
      .contains('deleted_item_data', { reason: 'tripwire_blocked' });
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
