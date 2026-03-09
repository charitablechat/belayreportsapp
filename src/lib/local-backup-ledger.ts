/**
 * Local Backup Ledger — localStorage-based immutable snapshot system
 * 
 * Provides a secondary persistence layer that survives IndexedDB eviction.
 * Every report save writes a compressed snapshot to localStorage under
 * a predictable key. Only explicit user-initiated deletes can remove snapshots.
 * 
 * Storage budget: ~4MB with LRU eviction of synced-only snapshots.
 * Unsynced snapshots are NEVER evicted.
 */

import { isMobile } from './mobile-detection';
import { uploadSnapshotToCloud } from './cloud-backup';

const BACKUP_PREFIX = 'rw_backup_';
const SCHEMA_VERSION = 1;
const MAX_STORAGE_BYTES = 4 * 1024 * 1024; // 4MB budget

export type ReportType = 'inspection' | 'training' | 'daily_assessment';

export interface PhotoMetadataEntry {
  id: string;
  caption?: string | null;
  photo_section?: string | null;
  display_order?: number | null;
  uploaded?: boolean;
}

export interface ReportSnapshot {
  v: number;
  ts: number;
  synced: boolean;
  device: 'mobile' | 'desktop';
  parent: Record<string, any>;
  children: Record<string, any[]>;
  photoMetadata?: PhotoMetadataEntry[];
}

function makeKey(type: ReportType, id: string): string {
  return `${BACKUP_PREFIX}${type}_${id}`;
}

/**
 * Estimate total bytes used by all backup keys in localStorage
 */
function estimateBackupStorageBytes(): number {
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(BACKUP_PREFIX)) {
      const value = localStorage.getItem(key);
      if (value) {
        total += key.length * 2 + value.length * 2; // UTF-16
      }
    }
  }
  return total;
}

/**
 * Evict oldest synced snapshots to make room for new data.
 * NEVER evicts unsynced snapshots.
 */
function evictIfNeeded(requiredBytes: number): void {
  const currentBytes = estimateBackupStorageBytes();
  if (currentBytes + requiredBytes <= MAX_STORAGE_BYTES) return;

  // Collect all synced snapshots with timestamps
  const syncedEntries: { key: string; ts: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(BACKUP_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const snapshot: ReportSnapshot = JSON.parse(raw);
      if (snapshot.synced) {
        syncedEntries.push({ key, ts: snapshot.ts });
      }
    } catch {
      // Corrupt entry — safe to remove
      if (key) syncedEntries.push({ key, ts: 0 });
    }
  }

  // Sort oldest first
  syncedEntries.sort((a, b) => a.ts - b.ts);

  let freed = 0;
  const bytesToFree = (currentBytes + requiredBytes) - MAX_STORAGE_BYTES;
  
  for (const entry of syncedEntries) {
    if (freed >= bytesToFree) break;
    const value = localStorage.getItem(entry.key);
    if (value) {
      freed += entry.key.length * 2 + value.length * 2;
      localStorage.removeItem(entry.key);
      if (import.meta.env.DEV) {
        console.log('[Backup Ledger] Evicted synced snapshot:', entry.key);
      }
    }
  }
}

/**
 * Save a complete report snapshot to localStorage.
 * Called after every successful IndexedDB write and on emergency save.
 */
export function saveReportSnapshot(
  reportType: ReportType,
  reportId: string,
  parentData: Record<string, any>,
  childData: Record<string, any[]>,
  isSynced: boolean = false,
  photoMetadata?: PhotoMetadataEntry[]
): void {
  try {
    // Block all writes in Lovable preview to protect production data
    if (window.location.hostname.includes('id-preview--')) return;
    const snapshot: ReportSnapshot = {
      v: SCHEMA_VERSION,
      ts: Date.now(),
      synced: isSynced,
      device: isMobile() ? 'mobile' : 'desktop',
      parent: parentData,
      children: childData,
      photoMetadata,
    };

    const key = makeKey(reportType, reportId);
    const json = JSON.stringify(snapshot);
    const estimatedBytes = (key.length + json.length) * 2;

    // Evict old synced snapshots if needed
    evictIfNeeded(estimatedBytes);

    localStorage.setItem(key, json);

    console.debug(`[Backup Ledger] Saved ${reportType} snapshot:`, reportId.substring(0, 8), 
      `(${(json.length / 1024).toFixed(1)}KB, synced=${isSynced})`);

    // Fire-and-forget cloud upload — non-blocking, silent on failure
    uploadSnapshotToCloud(reportType, reportId, snapshot);
  } catch (error) {
    // localStorage is full or unavailable — fail silently
    console.warn('[Backup Ledger] Failed to save snapshot:', error);
  }
}

/**
 * Retrieve a report snapshot from localStorage.
 */
export function getReportSnapshot(
  reportType: ReportType,
  reportId: string
): ReportSnapshot | null {
  try {
    const key = makeKey(reportType, reportId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as ReportSnapshot;
  } catch {
    return null;
  }
}

/**
 * List all stored snapshots with metadata (no full data).
 */
export function listAllSnapshots(): Array<{
  key: string;
  reportType: ReportType;
  reportId: string;
  timestamp: number;
  synced: boolean;
  device: string;
  sizeBytes: number;
  organization?: string;
}> {
  try {
    const results: Array<{
      key: string;
      reportType: ReportType;
      reportId: string;
      timestamp: number;
      synced: boolean;
      device: string;
      sizeBytes: number;
      organization?: string;
    }> = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(BACKUP_PREFIX)) continue;

      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        
        const snapshot: ReportSnapshot = JSON.parse(raw);
        const suffix = key.slice(BACKUP_PREFIX.length);
        
        // Parse type and id from key: {type}_{uuid}
        let reportType: ReportType;
        let reportId: string;
        
        if (suffix.startsWith('inspection_')) {
          reportType = 'inspection';
          reportId = suffix.slice('inspection_'.length);
        } else if (suffix.startsWith('training_')) {
          reportType = 'training';
          reportId = suffix.slice('training_'.length);
        } else if (suffix.startsWith('daily_assessment_')) {
          reportType = 'daily_assessment';
          reportId = suffix.slice('daily_assessment_'.length);
        } else {
          continue;
        }

        results.push({
          key,
          reportType,
          reportId,
          timestamp: snapshot.ts,
          synced: snapshot.synced,
          device: snapshot.device,
          sizeBytes: raw.length * 2,
          organization: snapshot.parent?.organization,
        });
      } catch {
        // Skip corrupt entries
      }
    }

    // Sort by timestamp descending (newest first)
    results.sort((a, b) => b.timestamp - a.timestamp);
    return results;
  } catch (error) {
    console.error('[Backup Ledger] Failed to list snapshots:', error);
    return [];
  }
}

/**
 * Delete a report snapshot. Only callable from explicit user-initiated delete.
 */
export function deleteReportSnapshot(
  reportType: ReportType,
  reportId: string
): void {
  const key = makeKey(reportType, reportId);
  localStorage.removeItem(key);
  
  if (import.meta.env.DEV) {
    console.log('[Backup Ledger] Deleted snapshot:', key);
  }
}

/**
 * Mark a snapshot as synced (updates sync status without replacing data).
 */
export function markSnapshotSynced(
  reportType: ReportType,
  reportId: string
): void {
  try {
    const key = makeKey(reportType, reportId);
    const raw = localStorage.getItem(key);
    if (!raw) return;
    
    const snapshot: ReportSnapshot = JSON.parse(raw);
    snapshot.synced = true;
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    // Fail silently
  }
}

/**
 * Get total storage used by all backup snapshots.
 */
export function getBackupStorageInfo(): {
  totalBytes: number;
  snapshotCount: number;
  unsyncedCount: number;
} {
  try {
    let totalBytes = 0;
    let snapshotCount = 0;
    let unsyncedCount = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(BACKUP_PREFIX)) continue;
      
      const raw = localStorage.getItem(key);
      if (raw) {
        totalBytes += (key.length + raw.length) * 2;
        snapshotCount++;
        try {
          const snapshot: ReportSnapshot = JSON.parse(raw);
          if (!snapshot.synced) unsyncedCount++;
        } catch {}
      }
    }

    return { totalBytes, snapshotCount, unsyncedCount };
  } catch (error) {
    console.error('[Backup Ledger] Failed to get storage info:', error);
    return { totalBytes: 0, snapshotCount: 0, unsyncedCount: 0 };
  }
}
