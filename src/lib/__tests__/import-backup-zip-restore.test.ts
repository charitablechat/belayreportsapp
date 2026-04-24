import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Coverage for H2 + C1 in the ZIP-import restore path
 * (src/lib/local-backup-ledger.ts:importReportBackup).
 *
 * The admin / cloud restore paths in DataRecoveryTool already wrap their work
 * in `withRestoreLock` and call `verifyRestoreIntegrity`. The ZIP-import path
 * historically did neither, and additionally wrote photo `uploaded: false`
 * (a boolean), which Safari's spec-strict IDB silently drops from the
 * `by-uploaded` index — the restored photos would then never sync.
 *
 * This suite locks all three guarantees:
 *   1. Restore lock is held for the duration of the IDB write.
 *   2. Imported photos persist `uploaded` as a number (0|1 contract — C1).
 *   3. Drift between snapshot.parent and the live IDB row triggers re-apply.
 */

const DB_NAME = 'rope-works-inspections';

function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

async function buildSyntheticZip(opts: {
  reportId: string;
  parent: Record<string, any>;
  photoBytes: Uint8Array;
  photoName: string;
}): Promise<File> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('backup.json', JSON.stringify({
    reportType: 'inspection',
    reportId: opts.reportId,
    snapshot: {
      v: 1,
      ts: Date.now(),
      synced: false,
      device: 'desktop',
      parent: opts.parent,
      children: {},
    },
  }));
  zip.folder('photos')!.file(opts.photoName, opts.photoBytes);
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'backup.zip', { type: 'application/zip' });
}

describe('importReportBackup — H2 + C1 restore guarantees', () => {
  beforeEach(async () => {
    await deleteDb();
    vi.resetModules();
  });

  it('C1: imported photos persist uploaded as a number (queryable via getUnuploadedPhotos)', async () => {
    // Stub the cloud upload so the test stays offline.
    vi.doMock('@/lib/cloud-backup', () => ({
      uploadSnapshotToCloud: vi.fn().mockResolvedValue(undefined),
    }));

    const ledger = await import('@/lib/local-backup-ledger');
    const offline = await import('@/lib/offline-storage');

    const file = await buildSyntheticZip({
      reportId: 'insp-c1',
      parent: {
        id: 'insp-c1',
        organization: 'Acme',
        location: 'Site 1',
        status: 'in_progress',
        updated_at: new Date().toISOString(),
        inspection_date: '2025-01-01',
      },
      photoBytes: new Uint8Array([1, 2, 3]),
      photoName: 'photo-c1.jpg',
    });

    const result = await ledger.importReportBackup(file);
    expect(result.reportId).toBe('insp-c1');
    expect(result.photoCount).toBe(1);

    const unsynced = (await offline.getUnuploadedPhotos()) as any[];
    const row = unsynced.find(p => p.id === 'photo-c1');
    expect(row).toBeDefined();
    expect(typeof row.uploaded).toBe('number');
    expect(row.uploaded).toBe(0);
  });

  it('H2: restore lock is held during the IDB write phase', async () => {
    vi.doMock('@/lib/cloud-backup', () => ({
      uploadSnapshotToCloud: vi.fn().mockResolvedValue(undefined),
    }));

    const ledger = await import('@/lib/local-backup-ledger');
    const lock = await import('@/lib/restore-lock');

    expect(lock.isRestoreInProgress()).toBe(false);

    let observedDuringRestore = false;
    const unsubscribe = lock.onRestoreLockChange((active) => {
      if (active) observedDuringRestore = true;
    });

    const file = await buildSyntheticZip({
      reportId: 'insp-h2',
      parent: {
        id: 'insp-h2',
        organization: 'Acme',
        location: 'Site 2',
        status: 'in_progress',
        updated_at: new Date().toISOString(),
        inspection_date: '2025-01-01',
      },
      photoBytes: new Uint8Array([9]),
      photoName: 'p.jpg',
    });

    await ledger.importReportBackup(file);
    unsubscribe();

    expect(observedDuringRestore).toBe(true);
    // And the lock is fully released after the import resolves.
    expect(lock.isRestoreInProgress()).toBe(false);
  });

  it('H2 integrity: drift between snapshot and live IDB row triggers a re-apply', async () => {
    vi.doMock('@/lib/cloud-backup', () => ({
      uploadSnapshotToCloud: vi.fn().mockResolvedValue(undefined),
    }));

    // Spy by intercepting the post-write read so it returns a stale row.
    // We mock getOfflineInspection (which verifyRestoreIntegrity calls) to
    // report the legacy `status: 'completed'` regardless of what was written.
    const reapplySpy = vi.fn();
    vi.doMock('@/lib/offline-storage', async (importOriginal) => {
      const actual: any = await importOriginal();
      return {
        ...actual,
        getOfflineInspection: vi.fn().mockResolvedValue({
          id: 'insp-h2-drift',
          organization: 'Acme',
          location: 'Site 3',
          status: 'completed', // ← drift from snapshot's 'in_progress'
          updated_at: '2025-01-01T00:00:00.000Z',
        }),
        saveInspectionOffline: vi.fn(async (parent: any) => {
          reapplySpy(parent);
          return true;
        }),
      };
    });

    const ledger = await import('@/lib/local-backup-ledger');

    const file = await buildSyntheticZip({
      reportId: 'insp-h2-drift',
      parent: {
        id: 'insp-h2-drift',
        organization: 'Acme',
        location: 'Site 3',
        status: 'in_progress', // ← snapshot says in_progress
        updated_at: new Date().toISOString(),
        inspection_date: '2025-01-01',
      },
      photoBytes: new Uint8Array([1]),
      photoName: 'p.jpg',
    });

    await ledger.importReportBackup(file);

    // Initial parent write + one re-apply due to status drift = 2 calls.
    expect(reapplySpy).toHaveBeenCalledTimes(2);
  });
});
