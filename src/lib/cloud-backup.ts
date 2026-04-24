/**
 * Cloud Backup — fire-and-forget upload of localStorage snapshots
 * to the central database for cross-device recovery.
 *
 * This module is a passive mirror. It never overwrites primary data.
 * Restores are explicit, user-initiated actions only.
 */

import { supabase } from '@/integrations/supabase/client';
import { getUserWithCache } from '@/lib/cached-auth';
import type { ReportType, ReportSnapshot } from './local-backup-ledger';

/** Opaque structural row type shared across report tables. */
type Row = Record<string, unknown>;

/** Narrow subset of the Supabase client used for dynamic table names.
 * Mirrors the DynamicSupabaseClient pattern from atomic-sync-manager.ts /
 * transaction-manager.ts — models only the methods this module actually calls. */
type PgResult<T> = Promise<{ data: T | null; error: { message?: string } | null }>;
type DynamicSupabaseClient = {
  from: (table: string) => {
    select: (columns: string) => {
      order: (column: string, opts: { ascending: boolean }) => {
        limit: (n: number) => PgResult<Row[]>;
      };
      eq: (column: string, value: unknown) => PgResult<Row[]> & {
        single: () => PgResult<Row>;
      };
    };
    upsert: (data: Row | Row[], opts?: { onConflict: string }) => PgResult<Row[]>;
    insert: (data: Row | Row[]) => PgResult<Row[]>;
    update: (data: Row) => {
      eq: (column: string, value: unknown) => {
        eq: (column: string, value: unknown) => {
          eq: (column: string, value: unknown) => PgResult<Row[]>;
        } & PgResult<Row[]>;
      } & PgResult<Row[]>;
    };
    delete: () => {
      eq: (column: string, value: unknown) => PgResult<Row[]>;
    };
  };
  rpc: (fn: string, args?: Record<string, unknown>) => PgResult<unknown>;
};

const sb = supabase as unknown as DynamicSupabaseClient;

export interface CloudBackupEntry {
  id: string;
  report_type: string;
  report_id: string;
  device: string;
  synced: boolean;
  snapshot_ts: number;
  created_at: string;
  user_name: string;
  facility: string;
}

export interface CloudBackupFull extends CloudBackupEntry {
  snapshot_data: {
    parent: Record<string, unknown>;
    children: Record<string, Record<string, unknown>[]>;
    photoMetadata?: Record<string, unknown>[];
  };
}

/**
 * Upload a snapshot to the cloud. Fire-and-forget — failures are silent.
 * Called after every successful localStorage snapshot write.
 */
// ── Error callback registry with rate limiting ──────────────────
type CloudBackupErrorCallback = (error: string) => void;
const _errorCallbacks = new Set<CloudBackupErrorCallback>();
let _lastErrorNotifiedAt = 0;
const ERROR_THROTTLE_MS = 60_000; // 1 warning per minute max

export function onCloudBackupError(cb: CloudBackupErrorCallback): () => void {
  _errorCallbacks.add(cb);
  return () => { _errorCallbacks.delete(cb); };
}

function _notifyError(message: string): void {
  const now = Date.now();
  if (now - _lastErrorNotifiedAt < ERROR_THROTTLE_MS) return;
  _lastErrorNotifiedAt = now;
  for (const cb of _errorCallbacks) {
    try { cb(message); } catch { /* swallow */ }
  }
}

export function uploadSnapshotToCloud(
  reportType: ReportType,
  reportId: string,
  snapshot: ReportSnapshot
): void {
  // Fire-and-forget — don't await
  _doUpload(reportType, reportId, snapshot).catch((err: unknown) => {
    console.warn('[Cloud Backup] Upload failed (non-blocking):', err);
    const message = (err as { message?: unknown } | null | undefined)?.message;
    _notifyError(String(typeof message === 'string' ? message : err));
  });
}

/**
 * M1 guard: refuse to upload "empty" snapshots that would clobber a richer
 * cloud copy via upsert.
 *
 * A snapshot is considered empty when EVERY child table is empty/missing AND
 * the parent has no user-authored content (only system fields like id /
 * timestamps / inspector_id). This catches the auto-save-during-mid-load race
 * where React state is briefly empty before children rehydrate.
 */
function _isEmptySnapshot(snapshot: ReportSnapshot): boolean {
  const children = snapshot.children || {};
  const hasAnyChildren = Object.values(children).some(
    (rows) => Array.isArray(rows) && rows.length > 0
  );
  if (hasAnyChildren) return false;

  const parent = snapshot.parent || {};
  // System-managed fields that don't represent user content.
  const SYSTEM_KEYS = new Set([
    'id', 'user_id', 'inspector_id', 'organization_id', 'created_at',
    'updated_at', 'synced_at', 'deleted_at', 'deleted_by', 'retention_until',
    'last_opened_at', 'last_modified_by', 'last_sync_source',
    'latest_report_html', 'latest_report_generated_at', 'report_version',
    'version', 'status',
  ]);
  const hasUserContent = Object.entries(parent).some(([key, value]) => {
    if (SYSTEM_KEYS.has(key)) return false;
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true; // numbers, booleans, etc.
  });

  return !hasUserContent;
}

async function _doUpload(
  reportType: ReportType,
  reportId: string,
  snapshot: ReportSnapshot
): Promise<void> {
  const user = await getUserWithCache();
  if (!user) return;

  // M1: never overwrite cloud with an empty snapshot. The next meaningful
  // save will upload as normal.
  if (_isEmptySnapshot(snapshot)) {
    if (import.meta.env.DEV) {
      console.log('[Cloud Backup] Skipping upload — empty snapshot', {
        reportType,
        reportId,
      });
    }
    return;
  }

  const parentRecord = (snapshot.parent ?? {}) as Record<string, unknown>;
  const facility =
    (typeof parentRecord.organization === 'string' ? parentRecord.organization : null) ||
    (typeof parentRecord.site === 'string' ? parentRecord.site : null) ||
    '';

  const { error } = await sb.from('report_cloud_backups').upsert(
    {
      user_id: user.id,
      report_type: reportType,
      report_id: reportId,
      device: snapshot.device,
      synced: snapshot.synced,
      snapshot_data: {
        parent: snapshot.parent,
        children: snapshot.children,
        photoMetadata: snapshot.photoMetadata,
      },
      snapshot_ts: snapshot.ts,
      facility,
    },
    { onConflict: 'user_id,report_type,report_id' }
  );

  if (error) throw new Error(error.message);
}

/**
 * Fetch cloud backup metadata (no full snapshot data) for the current user.
 */
export async function fetchCloudSnapshots(): Promise<CloudBackupEntry[]> {
  const { data, error } = await sb.from('report_cloud_backups')
    .select('id, report_type, report_id, device, synced, snapshot_ts, created_at, user_id, facility')
    .order('snapshot_ts', { ascending: false })
    .limit(50);

  if (error) {
    console.warn('[Cloud Backup] Failed to fetch snapshots:', error.message);
    return [];
  }

  if (!data || data.length === 0) return [];
  const rows = data;

  const { getCachedProfile } = await import('@/lib/profile-cache');
  const uniqueUserIds = [
    ...new Set(
      rows
        .map((d) => (d as { user_id?: unknown }).user_id)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
  const profileMap = new Map<string, string>();

  await Promise.all(
    uniqueUserIds.map(async (uid) => {
      const profile = await getCachedProfile(uid);
      const name = profile
        ? [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
        : 'Unknown';
      profileMap.set(uid, name || 'Unknown');
    })
  );

  return rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    const userId = typeof row.user_id === 'string' ? row.user_id : '';
    return {
      id: String(row.id ?? ''),
      report_type: String(row.report_type ?? ''),
      report_id: String(row.report_id ?? ''),
      device: String(row.device ?? ''),
      synced: row.synced === true,
      snapshot_ts: typeof row.snapshot_ts === 'number' ? row.snapshot_ts : 0,
      created_at: String(row.created_at ?? ''),
      user_name: profileMap.get(userId) || 'Unknown',
      facility: typeof row.facility === 'string' && row.facility ? row.facility : 'N/A',
    };
  });
}

/**
 * Fetch a single cloud backup with full snapshot data for restore.
 */
export async function fetchCloudSnapshot(id: string): Promise<CloudBackupFull | null> {
  const { data, error } = await sb.from('report_cloud_backups')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    console.warn('[Cloud Backup] Failed to fetch snapshot:', error?.message);
    return null;
  }
  return data as unknown as CloudBackupFull;
}

/**
 * Mark a cloud backup as synced. Fire-and-forget — failures are silent.
 */
export function markCloudBackupSynced(
  reportType: string,
  reportId: string
): void {
  _doMarkSynced(reportType, reportId).catch((err) => {
    console.warn('[Cloud Backup] Failed to mark synced (non-blocking):', err);
  });
}

async function _doMarkSynced(reportType: string, reportId: string): Promise<void> {
  const user = await getUserWithCache();
  if (!user) return;

  const { error } = await sb.from('report_cloud_backups')
    .update({ synced: true })
    .eq('user_id', user.id)
    .eq('report_type', reportType)
    .eq('report_id', reportId);

  if (error) {
    console.warn('[Cloud Backup] Mark synced failed:', error.message);
  }
}

/**
 * Delete a cloud backup by id.
 */
export async function deleteCloudSnapshot(id: string): Promise<boolean> {
  const { error } = await sb.from('report_cloud_backups')
    .delete()
    .eq('id', id);

  if (error) {
    console.warn('[Cloud Backup] Failed to delete snapshot:', error.message);
    return false;
  }
  return true;
}

// ── Super Admin: All-user snapshots ──────────────────────────────

export interface AllUserCloudSnapshot extends CloudBackupEntry {
  user_id: string;
  user_name: string;
}

/**
 * Fetch cloud backup metadata for ALL users (super admin only).
 * Joins with profiles to get user names. RLS enforces super-admin access.
 */
export async function fetchAllCloudSnapshots(): Promise<AllUserCloudSnapshot[]> {
  const { data, error } = await sb.from('report_cloud_backups')
    .select('id, report_type, report_id, device, synced, snapshot_ts, created_at, user_id, facility')
    .order('snapshot_ts', { ascending: false })
    .limit(200);

  if (error) {
    console.warn('[Cloud Backup] Failed to fetch all snapshots:', error.message);
    return [];
  }

  if (!data || data.length === 0) return [];
  const rows = data;

  // Batch-fetch profile names for unique user IDs
  const { getCachedProfile } = await import('@/lib/profile-cache');
  const uniqueUserIds = [
    ...new Set(
      rows
        .map((d) => (d as { user_id?: unknown }).user_id)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
  const profileMap = new Map<string, string>();

  await Promise.all(
    uniqueUserIds.map(async (uid) => {
      const profile = await getCachedProfile(uid);
      const name = profile
        ? [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
        : 'Unknown User';
      profileMap.set(uid, name || 'Unknown User');
    })
  );

  return rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    const userId = typeof row.user_id === 'string' ? row.user_id : '';
    return {
      ...(row as unknown as AllUserCloudSnapshot),
      user_name: profileMap.get(userId) || 'Unknown User',
      facility: typeof row.facility === 'string' && row.facility ? row.facility : 'N/A',
    };
  });
}

/**
 * Restore a cloud backup snapshot directly to the database (server-side restore).
 * Used by super admins — writes parent via upsert and children via upsert.
 */
export async function restoreSnapshotToServer(snapshotId: string): Promise<boolean> {
  const full = await fetchCloudSnapshot(snapshotId);
  if (!full) return false;

  const { parent, children } = full.snapshot_data;
  const reportType = full.report_type as ReportType;

  try {
    // Map report type to parent table and FK column
    const parentTable = reportType === 'inspection' ? 'inspections'
      : reportType === 'training' ? 'trainings'
      : 'daily_assessments';
    const fkColumn = reportType === 'inspection' ? 'inspection_id'
      : reportType === 'training' ? 'training_id'
      : 'assessment_id';

    // Upsert parent record (single row by ID — upsert is equivalent to replace)
    const { error: parentError } = await sb.from(parentTable)
      .upsert(parent, { onConflict: 'id' });

    if (parentError) {
      console.error('[Cloud Backup] Server restore parent failed:', parentError.message);
      return false;
    }

    // V7-style safety: capture pre_restore snapshot of CURRENT server state so this restore is reversible
    try {
      const { capturePreEditSnapshot } = await import('./admin-edit-snapshot');
      const { data: { user } } = await supabase.auth.getUser();
      const parentRec = (parent ?? {}) as Record<string, unknown>;
      const parentInspectorId =
        typeof parentRec.inspector_id === 'string' ? parentRec.inspector_id : null;
      const ownerId = parentInspectorId || user?.id;
      if (user && ownerId) {
        capturePreEditSnapshot(reportType, full.report_id, ownerId, user.id);
      }
    } catch (e) {
      console.warn('[Cloud Backup] pre_restore snapshot capture failed (non-blocking):', e);
    }

    const { assertSafeToDeleteChildRows } = await import('./child-row-deletion-tripwire');

    // Server-side trigger opt-in (replacement is intentional bulk operation)
    try { await sb.rpc('set_bulk_delete_opt_in'); } catch (e) {
      console.warn('[Cloud Backup] set_bulk_delete_opt_in rpc failed:', e);
    }

    // Replace children — delete existing then insert snapshot rows
    for (const [tableKey, rows] of Object.entries(children)) {
      // Gap A fix: skip delete entirely when snapshot table is empty/missing — preserve current server data
      if (!Array.isArray(rows) || rows.length === 0) {
        console.warn(`[Cloud Backup] Snapshot has no rows for ${tableKey} -- skipping delete to preserve current server data`);
        continue;
      }

      // Fetch live IDs and route through tripwire (bulk: true legitimate replacement)
      const { data: existingRows } = await sb.from(tableKey)
        .select('id')
        .eq(fkColumn, full.report_id);
      const existingIds = (existingRows || [])
        .map((r) => (r as { id?: unknown }).id)
        .filter((id): id is string => typeof id === 'string');

      if (existingIds.length > 0) {
        const tw = await assertSafeToDeleteChildRows({
          table: tableKey,
          parentFkColumn: fkColumn,
          parentId: full.report_id,
          idsToDelete: existingIds,
          context: { source: 'cloud_restore', bulk: true, reason: 'cloud_snapshot_restore', reportType },
        });
        if (!tw.allowed) {
          console.warn(`[Cloud Backup] Tripwire blocked restore delete for ${tableKey}; skipping`);
          continue;
        }

        const { error: deleteError } = await sb.from(tableKey)
          .delete()
          .eq(fkColumn, full.report_id);
        if (deleteError) {
          console.warn(`[Cloud Backup] Server restore delete ${tableKey} failed:`, deleteError.message);
        }
      }

      const { error: insertError } = await sb.from(tableKey)
        .insert(rows as Row[]);
      if (insertError) {
        console.warn(`[Cloud Backup] Server restore insert ${tableKey} failed:`, insertError.message);
      }
    }

    return true;
  } catch (error) {
    console.error('[Cloud Backup] Server restore failed:', error);
    return false;
  }
}
