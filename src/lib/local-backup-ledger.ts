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
import { safeSetItem } from './safe-local-storage';
import { withRestoreLock } from './restore-lock';
import { verifyRestoreIntegrity } from './restore-integrity';
import { toUploadedFlag } from './offline-storage';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parent: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children: Record<string, any[]>;
  photoMetadata?: PhotoMetadataEntry[];
}

function makeKey(type: ReportType, id: string): string {
  return `${BACKUP_PREFIX}${type}_${id}`;
}

/**
 * Estimate total bytes used by all backup keys in localStorage
 */
let _cachedStorageBytes = 0;
let _storageBytesTs = 0;
const STORAGE_BYTES_CACHE_TTL = 5000; // 5 seconds

function estimateBackupStorageBytes(): number {
  const now = Date.now();
  if (_cachedStorageBytes > 0 && (now - _storageBytesTs) < STORAGE_BYTES_CACHE_TTL) {
    return _cachedStorageBytes;
  }
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
  _cachedStorageBytes = total;
  _storageBytesTs = now;
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
  parentData: Record<string, unknown>,
  childData: Record<string, unknown[]>,
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

    const result = safeSetItem(key, json, {
      scope: 'backup-ledger.save',
      critical: !isSynced,
      onFail: (code) => {
        if (code === 'quota') {
          // Aggressive eviction with doubled budget, then retry once
          evictIfNeeded(estimatedBytes * 2);
          const retry = safeSetItem(key, json, { scope: 'backup-ledger.save.retry' });
          if (retry.ok) {
            _storageBytesTs = 0; // invalidate cache
          }
        }
      },
    });

    if (result.ok) {
      _storageBytesTs = 0; // invalidate cached storage size after successful write
    }

    console.debug(`[Backup Ledger] Saved ${reportType} snapshot:`, reportId.substring(0, 8), 
      `(${(json.length / 1024).toFixed(1)}KB, synced=${isSynced}, ok=${result.ok})`);

    // Fire-and-forget cloud upload — non-blocking, silent on failure
    uploadSnapshotToCloud(reportType, reportId, snapshot);
  } catch (error) {
    // Unexpected error (JSON.stringify, etc.) — fail silently
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
          organization: snapshot.parent?.organization as string | undefined,
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
    if (snapshot.synced) return; // Already marked — skip redundant write + cloud call
    snapshot.synced = true;
    const result = safeSetItem(key, JSON.stringify(snapshot), {
      scope: 'backup-ledger.markSynced',
      critical: false,
    });
    if (result.ok) {
      _storageBytesTs = 0; // invalidate cache
    }

    // Fire-and-forget: also update the cloud backup's synced flag
    import('./cloud-backup').then(({ markCloudBackupSynced }) => {
      markCloudBackupSynced(reportType, reportId);
    }).catch(() => { /* swallow */ });
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

/**
 * Download a single report's snapshot as a JSON file to the user's device.
 * Returns true on success, false if no snapshot exists.
 */
/**
 * Sanitize a string for use in a filename — replace non-alphanumeric chars with underscores.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 60); // cap length
}

function buildBackupFilename(org: string | undefined, ext: 'zip' | 'json'): string {
  const name = sanitizeFilename(org || 'report');
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${name}_${yyyy}-${mm}-${dd}_${hh}-${min}.${ext}`;
}

export async function downloadReportBackup(
  reportType: ReportType,
  reportId: string
): Promise<boolean> {
  try {
    const snapshot = getReportSnapshot(reportType, reportId);
    if (!snapshot) return false;

    const payload = {
      exportedAt: new Date().toISOString(),
      reportType,
      reportId,
      snapshot,
    };

    const org = snapshot.parent?.organization as string | undefined;
    const json = JSON.stringify(payload, null, 2);

    // Try to collect photos and build a ZIP
    let photoCount = 0;
    try {
      const { getOfflinePhotos } = await import('@/lib/offline-storage');
      const photos = await getOfflinePhotos(reportId);

      // Collect photo blobs — from IDB first, then signed URL fallback
      const photoEntries: { name: string; blob: Blob }[] = [];
      for (const photo of photos) {
        if (photo.blob) {
          const ext = photo.fileName?.split('.').pop() || 'jpg';
          photoEntries.push({ name: `${photo.id}.${ext}`, blob: photo.blob });
        } else if (photo.photoUrl) {
          try {
            const { supabase } = await import('@/integrations/supabase/client');
            const bucket = photo.storageBucket || 'inspection-photos';
            const { data } = await supabase.storage.from(bucket).createSignedUrl(photo.photoUrl, 60);
            if (data?.signedUrl) {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 5000);
              const resp = await fetch(data.signedUrl, { signal: controller.signal });
              clearTimeout(timeout);
              if (resp.ok) {
                const blob = await resp.blob();
                const ext = photo.fileName?.split('.').pop() || 'jpg';
                photoEntries.push({ name: `${photo.id}.${ext}`, blob });
              }
            }
          } catch {
            // Skip this photo
          }
        }
      }

      if (photoEntries.length > 0) {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        zip.file('backup.json', json);
        const photosFolder = zip.folder('photos')!;
        for (const entry of photoEntries) {
          photosFolder.file(entry.name, entry.blob);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        photoCount = photoEntries.length;

        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipBlob);
        link.download = buildBackupFilename(org, 'zip');
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => { document.body.removeChild(link); URL.revokeObjectURL(link.href); }, 100);
        return true;
      }
    } catch (zipError) {
      console.warn('[Backup Ledger] ZIP creation failed, falling back to JSON:', zipError);
    }

    // Fallback: plain JSON download (no photos or ZIP failed)
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildBackupFilename(org, 'json');
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { document.body.removeChild(link); URL.revokeObjectURL(url); }, 100);
    return true;
  } catch (error) {
    console.warn('[Backup Ledger] Failed to download report backup:', error);
    return false;
  }
}

/**
 * Import a previously exported JSON backup file.
 * Validates structure, writes to localStorage, IndexedDB, and cloud.
 * Returns { success, reportType, reportId } or throws with a user-friendly message.
 */
/**
 * Infer reportType from a parent record's fields.
 */
function inferReportType(parent: Record<string, unknown>): ReportType | null {
  if ('inspection_date' in parent || ('location' in parent && 'acct_number' in parent)) {
    return 'inspection';
  }
  if ('start_date' in parent && 'end_date' in parent && 'trainee_names' in parent) {
    return 'training';
  }
  if ('assessment_date' in parent || ('site' in parent && 'environment_comments' in parent)) {
    return 'daily_assessment';
  }
  return null;
}

export async function importReportBackup(input: string | File): Promise<{
  reportType: ReportType;
  reportId: string;
  photoCount?: number;
}> {
  let jsonString: string;
  let zipPhotoEntries: { name: string; blob: Blob }[] = [];

  // Detect ZIP vs JSON
  if (input instanceof File) {
    const isZip = input.name.endsWith('.zip') || input.type === 'application/zip';
    if (isZip) {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(input);
      const backupJsonFile = zip.file('backup.json');
      if (!backupJsonFile) {
        throw new Error('ZIP archive does not contain a backup.json file.');
      }
      jsonString = await backupJsonFile.async('string');

      // Collect photo entries
      const photosFolder = zip.folder('photos');
      if (photosFolder) {
        const photoFiles: { name: string; file: { async: (type: 'blob') => Promise<Blob> } }[] = [];
        photosFolder.forEach((relativePath, file) => {
          if (!file.dir) {
            photoFiles.push({ name: relativePath, file });
          }
        });
        for (const pf of photoFiles) {
          const blob = await pf.file.async('blob');
          zipPhotoEntries.push({ name: pf.name, blob });
        }
      }
    } else {
      jsonString = await input.text();
    }
  } else {
    jsonString = input;
  }

  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(jsonString);
  } catch {
    throw new Error('Invalid JSON file — could not parse contents.');
  }

  // Reject arrays (bulk exports)
  if (Array.isArray(rawParsed)) {
    throw new Error('This looks like a bulk export containing multiple reports. Please import individual report files instead.');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = (rawParsed ?? {}) as any;

  // --- Normalize: support multiple export formats ---
  let reportType: ReportType | undefined = parsed.reportType ?? parsed.report_type;
  let reportId: string | undefined = parsed.reportId ?? parsed.report_id;
  let snapshot: ReportSnapshot | undefined = parsed.snapshot;

  // Format A: wrapper { reportType, reportId, snapshot } — standard downloadReportBackup format
  // Already extracted above.

  // Format B: cloud/admin export { snapshot_data, report_type, report_id, ... }
  if (!snapshot && parsed.snapshot_data && typeof parsed.snapshot_data === 'object') {
    snapshot = parsed.snapshot_data as ReportSnapshot;
    reportType = reportType ?? parsed.report_type;
    reportId = reportId ?? parsed.report_id;
  }

  // Format C: raw ReportSnapshot { v, ts, parent, children, ... } — DataRecoveryTool exports
  if (!snapshot && parsed.parent && parsed.children) {
    snapshot = parsed as ReportSnapshot;
    // Infer type and id from parent data
    if (!reportType) {
      reportType = inferReportType(parsed.parent) ?? undefined;
    }
    if (!reportId) {
      reportId = parsed.parent?.id;
    }
  }

  // --- Validate ---
  if (!reportType || !['inspection', 'training', 'daily_assessment'].includes(reportType)) {
    throw new Error(
      'Could not determine report type. The file may be in an unsupported format. ' +
      'Expected an inspection, training, or daily assessment backup.'
    );
  }
  if (!reportId || typeof reportId !== 'string') {
    throw new Error('Could not determine the report ID from this file.');
  }
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.parent || !snapshot.children) {
    throw new Error('Missing or invalid snapshot data (expected parent + children).');
  }

  // H2: All post-validation work must run under the restore lock so that
  // useAutoSync.performSync cannot race the restore and overwrite the freshly
  // landed parent/children. Matches the admin/cloud restore handlers.
  let photoCount = 0;
  await withRestoreLock(async () => {
    // 1. Write to localStorage
    saveReportSnapshot(
      reportType!,
      reportId!,
      snapshot!.parent,
      snapshot!.children,
      snapshot!.synced ?? false,
      snapshot!.photoMetadata
    );

    // 2. Write to IndexedDB
    const {
      saveInspectionOffline, saveRelatedDataOffline,
      saveTrainingOffline, saveTrainingDataOffline,
      saveDailyAssessmentOffline, saveAssessmentDataOffline,
      savePhotoOffline,
    } = await import('@/lib/offline-storage');

    const writeParent = async () => {
      if (reportType === 'inspection') await saveInspectionOffline(snapshot!.parent);
      else if (reportType === 'training') await saveTrainingOffline(snapshot!.parent);
      else if (reportType === 'daily_assessment') await saveDailyAssessmentOffline(snapshot!.parent);
    };

    if (reportType === 'inspection') {
      await saveInspectionOffline(snapshot!.parent);
      for (const [key, data] of Object.entries(snapshot!.children)) {
        if (Array.isArray(data)) {
          await saveRelatedDataOffline(key as any, reportId!, data);
        }
      }
    } else if (reportType === 'training') {
      await saveTrainingOffline(snapshot!.parent);
      for (const [key, data] of Object.entries(snapshot!.children)) {
        if (Array.isArray(data)) {
          await saveTrainingDataOffline(key as any, reportId!, data);
        }
      }
    } else if (reportType === 'daily_assessment') {
      await saveDailyAssessmentOffline(snapshot!.parent);
      for (const [key, data] of Object.entries(snapshot!.children)) {
        if (Array.isArray(data)) {
          await saveAssessmentDataOffline(key as any, reportId!, data);
        }
      }
    }

    // H2 + N-B: Verify the restored parent AND each child array. Re-apply
    // both on drift; the shared reapply callback below re-writes both so a
    // child-only regression is self-healing. N-C: verifier now throws if the
    // post-write read itself fails — the caller surfaces that to the user.
    const reapplyAll = async () => {
      await writeParent();
      if (reportType === 'inspection') {
        for (const [key, data] of Object.entries(snapshot!.children)) {
          if (Array.isArray(data)) await saveRelatedDataOffline(key as any, reportId!, data);
        }
      } else if (reportType === 'training') {
        for (const [key, data] of Object.entries(snapshot!.children)) {
          if (Array.isArray(data)) await saveTrainingDataOffline(key as any, reportId!, data);
        }
      } else if (reportType === 'daily_assessment') {
        for (const [key, data] of Object.entries(snapshot!.children)) {
          if (Array.isArray(data)) await saveAssessmentDataOffline(key as any, reportId!, data);
        }
      }
    };
    // N-C: verifier now throws on IDB read failure. The parent + children
    // data was already written in steps 1-2, so a verify failure does NOT
    // invalidate the restore — swallow it with a warning and keep going.
    // Steps 3-5 (photo import, cloud upload, report-data-imported dispatch)
    // MUST still run on verify failure; propagating the throw here would
    // skip them and surface a misleading "Import failed" to the user.
    try {
      await verifyRestoreIntegrity(
        reportType!,
        reportId!,
        snapshot!.parent,
        reapplyAll,
        { expectedChildren: snapshot!.children as Record<string, Array<{ id?: string | null }>> },
      );
    } catch (verifyErr) {
      console.warn('[Backup Ledger] Post-import verification failed — data was restored but drift check could not complete:', verifyErr);
    }

    // 3. Import photos from ZIP if present
    if (zipPhotoEntries.length > 0) {
      for (const entry of zipPhotoEntries) {
        const photoId = entry.name.replace(/\.[^.]+$/, ''); // strip extension to get ID
        try {
          await savePhotoOffline({
            id: photoId,
            inspectionId: reportId!,
            section: 'imported',
            blob: entry.blob,
            fileName: entry.name,
            // C1: photos.uploaded must be 0|1, never boolean — see
            // mem://constraints/photos-uploaded-index. Spec-strict browsers
            // (Safari) silently exclude boolean-keyed rows from `by-uploaded`.
            uploaded: toUploadedFlag(false),
            tableName: reportType === 'training' ? 'training_photos' :
                       reportType === 'daily_assessment' ? 'daily_assessment_photos' :
                       'inspection_photos',
            storageBucket: reportType === 'training' ? 'training-photos' :
                           reportType === 'daily_assessment' ? 'daily-assessment-photos' :
                           'inspection-photos',
            foreignKeyColumn: reportType === 'training' ? 'training_id' :
                              reportType === 'daily_assessment' ? 'assessment_id' :
                              'inspection_id',
          });
          photoCount++;
        } catch (err) {
          console.warn('[Backup Ledger] Failed to import photo:', entry.name, err);
        }
      }
    }

    // 4. Fire-and-forget cloud upload
    const { uploadSnapshotToCloud } = await import('@/lib/cloud-backup');
    uploadSnapshotToCloud(reportType!, reportId!, snapshot!);

    // 5. Notify any open form that data was imported so it can reload from IndexedDB
    window.dispatchEvent(new CustomEvent('report-data-imported', {
      detail: { reportType, reportId }
    }));
  });

  return { reportType, reportId, photoCount: photoCount > 0 ? photoCount : undefined };
}
