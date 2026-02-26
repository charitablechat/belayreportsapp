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
    .select('id, report_type, report_id, device, synced, snapshot_ts, created_at')
    .order('snapshot_ts', { ascending: false })
    .limit(50);

  if (error) {
    console.warn('[Cloud Backup] Failed to fetch snapshots:', error.message);
    return [];
  }
  return (data ?? []) as CloudBackupEntry[];
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
