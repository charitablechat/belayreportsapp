/**
 * H2: Post-restore integrity check (shared).
 *
 * After restoring a snapshot's parent record, re-read it from IDB and confirm
 * key identifying fields (organization, location/site, status, updated_at)
 * still match what we wrote. If any field regressed (e.g., a stray sync slipped
 * past the restore lock), log loudly and re-apply the parent once.
 *
 * Extracted from DataRecoveryTool.tsx so the ZIP-import restore path
 * (local-backup-ledger.importBackupZip) can share the exact same guarantee.
 */

import type { ReportType } from '@/lib/local-backup-ledger';

export async function verifyRestoreIntegrity(
  reportType: ReportType,
  reportId: string,
  expectedParent: any,
  reapply: () => Promise<void>,
): Promise<void> {
  try {
    const { getOfflineInspection, getOfflineTraining, getOfflineDailyAssessment } = await import('@/lib/offline-storage');
    const live: any = reportType === 'inspection'
      ? await getOfflineInspection(reportId)
      : reportType === 'training'
        ? await getOfflineTraining(reportId)
        : await getOfflineDailyAssessment(reportId);

    if (!live) {
      console.warn('[Restore Integrity] Live record missing after restore — re-applying parent', { reportType, reportId });
      await reapply();
      return;
    }

    const fieldsToCheck = ['organization', 'location', 'site', 'status', 'updated_at'];
    const drift: string[] = [];
    for (const field of fieldsToCheck) {
      if (expectedParent[field] === undefined) continue;
      // updated_at: only flag if the live record is OLDER than the snapshot
      if (field === 'updated_at') {
        const expectedMs = new Date(expectedParent.updated_at).getTime();
        const liveMs = live.updated_at ? new Date(live.updated_at).getTime() : 0;
        if (liveMs < expectedMs) drift.push(field);
        continue;
      }
      if (live[field] !== expectedParent[field]) drift.push(field);
    }

    if (drift.length > 0) {
      console.warn('[Restore Integrity] Field drift detected — re-applying parent', { reportType, reportId, drift });
      await reapply();
    }
  } catch (err) {
    console.error('[Restore Integrity] Verification failed', err);
  }
}
