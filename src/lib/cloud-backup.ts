/**
 * Cloud Backup — fire-and-forget upload of localStorage snapshots
 * to the central database for cross-device recovery.
 *
 * This module is a passive mirror. It never overwrites primary data.
 * Restores are explicit, user-initiated actions only.
 */

import { supabase } from '@/integrations/supabase/client';
import type { ReportType, ReportSnapshot } from './local-backup-ledger';

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
    parent: Record<string, any>;
    children: Record<string, any[]>;
    photoMetadata?: any[];
  };
}

/**
 * Upload a snapshot to the cloud. Fire-and-forget — failures are silent.
 * Called after every successful localStorage snapshot write.
 */
export function uploadSnapshotToCloud(
  reportType: ReportType,
  reportId: string,
  snapshot: ReportSnapshot
): void {
  // Fire-and-forget — don't await
  _doUpload(reportType, reportId, snapshot).catch(() => {
    // Silent failure — local backup is the safety net
  });
}

async function _doUpload(
  reportType: ReportType,
  reportId: string,
  snapshot: ReportSnapshot
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await (supabase.from('report_cloud_backups') as any).upsert(
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
    },
    { onConflict: 'user_id,report_type,report_id' }
  );
}

/**
 * Fetch cloud backup metadata (no full snapshot data) for the current user.
 */
export async function fetchCloudSnapshots(): Promise<CloudBackupEntry[]> {
  const { data, error } = await (supabase.from('report_cloud_backups') as any)
    .select('id, report_type, report_id, device, synced, snapshot_ts, created_at, user_id, snapshot_data')
    .order('snapshot_ts', { ascending: false })
    .limit(50);

  if (error) {
    console.warn('[Cloud Backup] Failed to fetch snapshots:', error.message);
    return [];
  }

  if (!data || data.length === 0) return [];

  const { getCachedProfile } = await import('@/lib/profile-cache');
  const uniqueUserIds = [...new Set((data as any[]).map((d: any) => d.user_id))] as string[];
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

  return (data as any[]).map((row: any) => ({
    id: row.id,
    report_type: row.report_type,
    report_id: row.report_id,
    device: row.device,
    synced: row.synced,
    snapshot_ts: row.snapshot_ts,
    created_at: row.created_at,
    user_name: profileMap.get(row.user_id) || 'Unknown',
    facility: row.snapshot_data?.parent?.organization
      || row.snapshot_data?.parent?.location
      || row.snapshot_data?.parent?.site
      || 'N/A',
  })) as CloudBackupEntry[];
}

/**
 * Fetch a single cloud backup with full snapshot data for restore.
 */
export async function fetchCloudSnapshot(id: string): Promise<CloudBackupFull | null> {
  const { data, error } = await (supabase.from('report_cloud_backups') as any)
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    console.warn('[Cloud Backup] Failed to fetch snapshot:', error?.message);
    return null;
  }
  return data as CloudBackupFull;
}

/**
 * Delete a cloud backup by id.
 */
export async function deleteCloudSnapshot(id: string): Promise<boolean> {
  const { error } = await (supabase.from('report_cloud_backups') as any)
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
  const { data, error } = await (supabase.from('report_cloud_backups') as any)
    .select('id, report_type, report_id, device, synced, snapshot_ts, created_at, user_id')
    .order('snapshot_ts', { ascending: false })
    .limit(200);

  if (error) {
    console.warn('[Cloud Backup] Failed to fetch all snapshots:', error.message);
    return [];
  }

  if (!data || data.length === 0) return [];

  // Batch-fetch profile names for unique user IDs
  const { getCachedProfile } = await import('@/lib/profile-cache');
  const uniqueUserIds = [...new Set((data as any[]).map((d: any) => d.user_id))] as string[];
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

  return (data as any[]).map((row: any) => ({
    ...row,
    user_name: profileMap.get(row.user_id) || 'Unknown User',
  })) as AllUserCloudSnapshot[];
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
    // Map report type to parent table
    const parentTable = reportType === 'inspection' ? 'inspections'
      : reportType === 'training' ? 'trainings'
      : 'daily_assessments';

    // Upsert parent record
    const { error: parentError } = await (supabase.from(parentTable as any) as any)
      .upsert(parent, { onConflict: 'id' });

    if (parentError) {
      console.error('[Cloud Backup] Server restore parent failed:', parentError.message);
      return false;
    }

    // Upsert children — each key maps to a child table
    for (const [tableKey, rows] of Object.entries(children)) {
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const { error: childError } = await (supabase.from(tableKey as any) as any)
        .upsert(rows, { onConflict: 'id' });
      if (childError) {
        console.warn(`[Cloud Backup] Server restore child ${tableKey} failed:`, childError.message);
        // Continue with other children — partial restore is better than none
      }
    }

    return true;
  } catch (error) {
    console.error('[Cloud Backup] Server restore failed:', error);
    return false;
  }
}
