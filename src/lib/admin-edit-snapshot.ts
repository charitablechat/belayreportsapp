/**
 * Admin Edit Snapshot — captures a full pre-edit copy of a report
 * before a Super Admin modifies someone else's data.
 *
 * Fire-and-forget: failures never block the save path.
 */

import { supabase } from '@/integrations/supabase/client';

type ReportType = 'inspection' | 'training' | 'daily_assessment';

/** Child table keys per report type */
const CHILD_TABLES: Record<ReportType, string[]> = {
  inspection: [
    'inspection_systems', 'inspection_ziplines', 'inspection_equipment',
    'inspection_standards', 'inspection_summary', 'inspection_photos',
  ],
  training: [
    'training_delivery_approaches', 'training_operating_systems',
    'training_immediate_attention', 'training_verifiable_items',
    'training_systems_in_place', 'training_summary', 'training_photos',
  ],
  daily_assessment: [
    'daily_assessment_beginning_of_day', 'daily_assessment_end_of_day',
    'daily_assessment_operating_systems', 'daily_assessment_equipment_checks',
    'daily_assessment_structure_checks', 'daily_assessment_environment_checks',
    'daily_assessment_photos',
  ],
};

/** FK column name that links child rows to the parent */
const PARENT_FK: Record<ReportType, string> = {
  inspection: 'inspection_id',
  training: 'training_id',
  daily_assessment: 'assessment_id',
};

const PARENT_TABLE: Record<ReportType, string> = {
  inspection: 'inspections',
  training: 'trainings',
  daily_assessment: 'daily_assessments',
};

/**
 * Capture a pre-edit snapshot of the current server-side data.
 * Called when an admin is about to save changes to someone else's report.
 * Fire-and-forget — never blocks or throws.
 */
export function capturePreEditSnapshot(
  reportType: ReportType,
  reportId: string,
  ownerId: string,
  editorId: string,
): void {
  _doCapture(reportType, reportId, ownerId, editorId).catch((err) => {
    console.warn('[AdminEditSnapshot] Capture failed (non-blocking):', err);
  });
}

async function _doCapture(
  reportType: ReportType,
  reportId: string,
  ownerId: string,
  editorId: string,
): Promise<void> {
  const parentTable = PARENT_TABLE[reportType];
  const fkColumn = PARENT_FK[reportType];
  const childTables = CHILD_TABLES[reportType];

  // Fetch current server-side parent
  const { data: parent, error: parentErr } = await (supabase.from(parentTable as any) as any)
    .select('*')
    .eq('id', reportId)
    .maybeSingle();

  if (parentErr || !parent) {
    console.warn('[AdminEditSnapshot] Could not fetch parent:', parentErr?.message);
    return;
  }

  // Fetch all children in parallel
  const childResults = await Promise.all(
    childTables.map(async (table) => {
      const { data } = await (supabase.from(table as any) as any)
        .select('*')
        .eq(fkColumn, reportId);
      return [table, data ?? []] as [string, any[]];
    })
  );

  const children: Record<string, any[]> = {};
  for (const [table, rows] of childResults) {
    children[table] = rows;
  }

  // Insert snapshot
  const { error: insertErr } = await (supabase.from('admin_edit_snapshots') as any)
    .insert({
      report_type: reportType,
      report_id: reportId,
      original_owner_id: ownerId,
      edited_by: editorId,
      snapshot_data: { parent, children },
    });

  if (insertErr) {
    console.warn('[AdminEditSnapshot] Insert failed:', insertErr.message);
  } else if (import.meta.env.DEV) {
    console.log('[AdminEditSnapshot] Pre-edit snapshot captured for', reportType, reportId);
  }
}

// ── Query & Restore (Admin Recovery UI) ──────────────────────────

export interface AdminEditSnapshotEntry {
  id: string;
  report_type: string;
  report_id: string;
  original_owner_id: string;
  edited_by: string;
  created_at: string;
  editor_name?: string;
  owner_name?: string;
}

/**
 * Fetch all admin edit snapshots (super admin only, RLS enforced).
 */
export async function fetchAdminEditSnapshots(): Promise<AdminEditSnapshotEntry[]> {
  const { data, error } = await (supabase.from('admin_edit_snapshots') as any)
    .select('id, report_type, report_id, original_owner_id, edited_by, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.warn('[AdminEditSnapshot] Failed to fetch:', error.message);
    return [];
  }

  if (!data || data.length === 0) return [];

  // Batch-resolve profile names
  const { getCachedProfile } = await import('@/lib/profile-cache');
  const allIds = [...new Set([
    ...(data as any[]).map((d: any) => d.edited_by),
    ...(data as any[]).map((d: any) => d.original_owner_id),
  ])] as string[];

  const nameMap = new Map<string, string>();
  await Promise.all(
    allIds.map(async (uid) => {
      const profile = await getCachedProfile(uid);
      const name = profile
        ? [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
        : 'Unknown';
      nameMap.set(uid, name || 'Unknown');
    })
  );

  return (data as any[]).map((row: any) => ({
    ...row,
    editor_name: nameMap.get(row.edited_by) || 'Unknown',
    owner_name: nameMap.get(row.original_owner_id) || 'Unknown',
  }));
}

/**
 * Restore a pre-edit snapshot back to the database (undo admin changes).
 */
export async function restoreAdminEditSnapshot(snapshotId: string): Promise<boolean> {
  // Fetch full snapshot data
  const { data: snapshot, error } = await (supabase.from('admin_edit_snapshots') as any)
    .select('*')
    .eq('id', snapshotId)
    .single();

  if (error || !snapshot) {
    console.error('[AdminEditSnapshot] Failed to fetch snapshot:', error?.message);
    return false;
  }

  const { parent, children } = snapshot.snapshot_data as {
    parent: Record<string, any>;
    children: Record<string, any[]>;
  };
  const reportType = snapshot.report_type as ReportType;
  const parentTable = PARENT_TABLE[reportType];
  const fkColumn = PARENT_FK[reportType];

  // V7: Capture a pre_restore snapshot of the CURRENT server state so the restore is itself reversible.
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      capturePreEditSnapshot(reportType, snapshot.report_id, snapshot.original_owner_id, user.id);
    }
  } catch (e) {
    console.warn('[AdminEditSnapshot] pre_restore capture failed (non-blocking):', e);
  }

  const { assertSafeToDeleteChildRows } = await import('./child-row-deletion-tripwire');

  // Server-side trigger opt-in (admin restore is intentional bulk replacement)
  try { await (supabase as any).rpc('set_bulk_delete_opt_in'); } catch (e) {
    console.warn('[AdminEditSnapshot] set_bulk_delete_opt_in rpc failed:', e);
  }

  try {
    // Upsert parent
    const { error: parentErr } = await (supabase.from(parentTable as any) as any)
      .upsert(parent, { onConflict: 'id' });
    if (parentErr) {
      console.error('[AdminEditSnapshot] Parent restore failed:', parentErr.message);
      return false;
    }

    // Replace children — delete existing then insert snapshot rows.
    // V7: SKIP the delete entirely when the snapshot table is empty/missing,
    // to preserve current server data instead of wiping it with nothing.
    for (const [table, rows] of Object.entries(children)) {
      if (!Array.isArray(rows) || rows.length === 0) {
        console.warn(`[AdminEditSnapshot] Snapshot has no rows for ${table} -- skipping delete to preserve current server data`);
        continue;
      }

      // Fetch live child IDs to route through the tripwire
      const { data: existingRows } = await (supabase.from(table as any) as any)
        .select('id')
        .eq(fkColumn, snapshot.report_id);
      const existingIds = (existingRows || []).map((r: any) => r.id);

      if (existingIds.length > 0) {
        const tripwire = await assertSafeToDeleteChildRows({
          table,
          parentFkColumn: fkColumn,
          parentId: snapshot.report_id,
          idsToDelete: existingIds,
          context: { source: 'admin_restore', bulk: true, reason: 'admin_snapshot_restore', reportType },
        });
        if (!tripwire.allowed) {
          console.warn(`[AdminEditSnapshot] Tripwire blocked restore delete for ${table}; skipping`);
          continue;
        }

        const { error: delErr } = await (supabase.from(table as any) as any)
          .delete()
          .eq(fkColumn, snapshot.report_id);
        if (delErr) {
          console.warn(`[AdminEditSnapshot] Child delete ${table} failed:`, delErr.message);
        }
      }

      const { error: childErr } = await (supabase.from(table as any) as any)
        .insert(rows);
      if (childErr) {
        console.warn(`[AdminEditSnapshot] Child insert ${table} failed:`, childErr.message);
      }
    }

    return true;
  } catch (err) {
    console.error('[AdminEditSnapshot] Restore failed:', err);
    return false;
  }
}
