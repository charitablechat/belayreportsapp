/**
 * Admin Edit Snapshot — captures a full pre-edit copy of a report
 * before a Super Admin modifies someone else's data.
 *
 * Fire-and-forget: failures never block the save path.
 */

import { supabase } from '@/integrations/supabase/client';

type ReportType = 'inspection' | 'training' | 'daily_assessment';

/** Opaque structural row type shared across report tables. */
type Row = Record<string, unknown>;

/** Narrow subset of the Supabase client used for dynamic table names.
 * Mirrors the DynamicSupabaseClient pattern used elsewhere in this repo. */
type PgResult<T> = Promise<{ data: T | null; error: { message?: string } | null }>;
type DynamicSupabaseClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => PgResult<Row[]> & {
        maybeSingle: () => PgResult<Row>;
        single: () => PgResult<Row>;
      };
      order: (column: string, opts: { ascending: boolean }) => {
        limit: (n: number) => PgResult<Row[]>;
      };
    };
    upsert: (data: Row | Row[], opts?: { onConflict: string }) => PgResult<Row[]>;
    insert: (data: Row | Row[]) => PgResult<Row[]>;
    delete: () => {
      eq: (column: string, value: unknown) => PgResult<Row[]>;
    };
  };
  rpc: (fn: string, args?: Record<string, unknown>) => PgResult<unknown>;
};

const sb = supabase as unknown as DynamicSupabaseClient;

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
  // H10: Always capture intent. If offline (or capture fails), fall back to
  // a local IDB queue that will be flushed on the next online sync cycle.
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;

  // Diagnostic entry log — fires regardless of import.meta.env.DEV so CI
  // logs reveal whether this function was even invoked. Without this we
  // cannot distinguish 'never called' from 'called and silently succeeded'
  // from 'called and silently failed' when the e2e admin-pre-edit spec
  // times out waiting for the snapshot row.
  console.log(
    '[AdminEditSnapshot] capturePreEditSnapshot called',
    { reportType, reportId, ownerId, editorId, online },
  );

  const enqueueFallback = (reason: string, err?: unknown) => {
    console.warn(`[AdminEditSnapshot] ${reason}, queuing locally:`, err ?? '(no error)');
    import('./admin-edit-snapshot-queue')
      .then(({ enqueueAdminEditIntent }) =>
        enqueueAdminEditIntent(reportType, reportId, ownerId, editorId))
      .then(() => console.log('[AdminEditSnapshot] enqueued for later drain'))
      .catch((qErr) => console.warn('[AdminEditSnapshot] enqueue failed:', qErr));
  };

  if (!online) {
    enqueueFallback('offline at capture time');
    return;
  }

  _doCapture(reportType, reportId, ownerId, editorId)
    .then(() => console.log('[AdminEditSnapshot] inline capture succeeded for', reportType, reportId))
    .catch((err) => {
      enqueueFallback('Capture failed (will retry from queue)', err);
    });
}

/**
 * Direct (online-only) capture used by the queue flusher. Throws on failure
 * so the caller can decide whether to keep the queue entry.
 */
export async function captureAdminEditSnapshotNow(
  reportType: ReportType,
  reportId: string,
  ownerId: string,
  editorId: string,
): Promise<void> {
  await _doCapture(reportType, reportId, ownerId, editorId);
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

  // Fetch current server-side parent. A transport / RLS / PostgREST error must
  // propagate so `capturePreEditSnapshot`'s `.catch` queues the intent for a
  // later `flushAdminEditQueue` cycle. A clean "row not found" (no error, null
  // data) is treated as a no-op — there is nothing to snapshot and retrying
  // would loop forever.
  console.log(`[AdminEditSnapshot] _doCapture: fetching parent ${parentTable} id=${reportId}`);
  const { data: parent, error: parentErr } = await sb.from(parentTable)
    .select('*')
    .eq('id', reportId)
    .maybeSingle();

  if (parentErr) {
    throw new Error(
      `[AdminEditSnapshot] parent fetch failed (${parentTable} id=${reportId}): ${parentErr.message ?? 'unknown error'}`,
    );
  }
  if (!parent) {
    console.warn(`[AdminEditSnapshot] parent ${parentTable} id=${reportId} not found — skipping snapshot.`);
    return;
  }
  console.log(`[AdminEditSnapshot] _doCapture: parent fetched, now fetching ${childTables.length} child tables`);

  // Fetch all children in parallel. If any child read errors, propagate so we
  // re-queue rather than capture a snapshot with a partial/empty children map.
  const childResults = await Promise.all(
    childTables.map(async (table) => {
      const { data, error } = await sb.from(table)
        .select('*')
        .eq(fkColumn, reportId);
      if (error) {
        throw new Error(
          `[AdminEditSnapshot] child fetch failed (${table} ${fkColumn}=${reportId}): ${error.message ?? 'unknown error'}`,
        );
      }
      return [table, data ?? []] as [string, Row[]];
    })
  );

  const children: Record<string, Row[]> = {};
  for (const [table, rows] of childResults) {
    children[table] = rows;
  }

  // Insert snapshot. Errors here MUST throw so the queue fallback re-attempts
  // on the next sync cycle; otherwise transient INSERT failures (RLS, network,
  // PostgREST schema cache) silently lose the snapshot — both inline AND from
  // the queue, since the queue is only filled when this function rejects.
  console.log('[AdminEditSnapshot] _doCapture: inserting snapshot row', {
    reportType, reportId, original_owner_id: ownerId, edited_by: editorId,
    childTablesCount: Object.keys(children).length,
  });
  const { error: insertErr } = await sb.from('admin_edit_snapshots')
    .insert({
      report_type: reportType,
      report_id: reportId,
      original_owner_id: ownerId,
      edited_by: editorId,
      snapshot_data: { parent, children },
    });

  if (insertErr) {
    throw new Error(
      `[AdminEditSnapshot] insert failed: ${insertErr.message ?? 'unknown error'}`,
    );
  }

  console.log('[AdminEditSnapshot] _doCapture: insert succeeded for', reportType, reportId);
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
  const { data, error } = await sb.from('admin_edit_snapshots')
    .select('id, report_type, report_id, original_owner_id, edited_by, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.warn('[AdminEditSnapshot] Failed to fetch:', error.message);
    return [];
  }

  if (!data || data.length === 0) return [];
  const rows = data;

  const pickString = (v: unknown): string | null => (typeof v === 'string' ? v : null);

  // Batch-resolve profile names
  const { getCachedProfile } = await import('@/lib/profile-cache');
  const allIds = [
    ...new Set(
      rows
        .flatMap((d) => [
          pickString((d as { edited_by?: unknown }).edited_by),
          pickString((d as { original_owner_id?: unknown }).original_owner_id),
        ])
        .filter((id): id is string => !!id),
    ),
  ];

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

  return rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    const editedBy = pickString(row.edited_by) ?? '';
    const ownerId = pickString(row.original_owner_id) ?? '';
    return {
      id: String(row.id ?? ''),
      report_type: String(row.report_type ?? ''),
      report_id: String(row.report_id ?? ''),
      original_owner_id: ownerId,
      edited_by: editedBy,
      created_at: String(row.created_at ?? ''),
      editor_name: nameMap.get(editedBy) || 'Unknown',
      owner_name: nameMap.get(ownerId) || 'Unknown',
    };
  });
}

/**
 * Restore a pre-edit snapshot back to the database (undo admin changes).
 */
export async function restoreAdminEditSnapshot(snapshotId: string): Promise<boolean> {
  // Fetch full snapshot data
  const { data: snapshot, error } = await sb.from('admin_edit_snapshots')
    .select('*')
    .eq('id', snapshotId)
    .single();

  if (error || !snapshot) {
    console.error('[AdminEditSnapshot] Failed to fetch snapshot:', error?.message);
    return false;
  }

  const snap = snapshot as Record<string, unknown>;
  const snapshotData = (snap.snapshot_data ?? {}) as {
    parent?: Record<string, unknown>;
    children?: Record<string, Row[]>;
  };
  const parent: Record<string, unknown> = snapshotData.parent ?? {};
  const children: Record<string, Row[]> = snapshotData.children ?? {};
  const reportType = snap.report_type as ReportType;
  const reportId = String(snap.report_id ?? '');
  const originalOwnerId = String(snap.original_owner_id ?? '');
  const parentTable = PARENT_TABLE[reportType];
  const fkColumn = PARENT_FK[reportType];

  // V7: Capture a pre_restore snapshot of the CURRENT server state so the restore is itself reversible.
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      capturePreEditSnapshot(reportType, reportId, originalOwnerId, user.id);
    }
  } catch (e) {
    console.warn('[AdminEditSnapshot] pre_restore capture failed (non-blocking):', e);
  }

  const { assertSafeToDeleteChildRows } = await import('./child-row-deletion-tripwire');

  // Server-side trigger opt-in (admin restore is intentional bulk replacement)
  try { await sb.rpc('set_bulk_delete_opt_in'); } catch (e) {
    console.warn('[AdminEditSnapshot] set_bulk_delete_opt_in rpc failed:', e);
  }

  try {
    // Upsert parent
    const { error: parentErr } = await sb.from(parentTable)
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
      const { data: existingRows } = await sb.from(table)
        .select('id')
        .eq(fkColumn, reportId);
      const existingIds = (existingRows || [])
        .map((r) => (r as { id?: unknown }).id)
        .filter((id): id is string => typeof id === 'string');

      if (existingIds.length > 0) {
        const tripwire = await assertSafeToDeleteChildRows({
          table,
          parentFkColumn: fkColumn,
          parentId: reportId,
          idsToDelete: existingIds,
          context: { source: 'admin_restore', bulk: true, reason: 'admin_snapshot_restore', reportType },
        });
        if (!tripwire.allowed) {
          console.warn(`[AdminEditSnapshot] Tripwire blocked restore delete for ${table}; skipping`);
          continue;
        }

        const { error: delErr } = await sb.from(table)
          .delete()
          .eq(fkColumn, reportId);
        if (delErr) {
          console.warn(`[AdminEditSnapshot] Child delete ${table} failed:`, delErr.message);
        }
      }

      const { error: childErr } = await sb.from(table)
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
