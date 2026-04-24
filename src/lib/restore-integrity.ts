/**
 * H2: Post-restore integrity check (shared).
 *
 * After restoring a snapshot's parent record, re-read it from IDB and confirm
 * key identifying fields (organization, location/site, status, updated_at)
 * still match what we wrote. If any field regressed (e.g., a stray sync slipped
 * past the restore lock), log loudly and re-apply the parent once.
 *
 * N-B: the verifier also re-reads every expected child-row array passed by
 * the caller. If the live row count changed OR any expected id went missing,
 * the restore is treated as regressed and `reapply()` is called. This closes
 * the gap where a concurrent sync deleted a child row after the restore lock
 * released but the parent's scalar fields still matched — the user would open
 * their "restored" report and find half of it missing with no warning.
 *
 * N-C: catastrophic failures now throw `RestoreVerificationError`. The only
 * `catch` is for the specific "live record missing" case, which remains a
 * recoverable re-apply. Callers are expected to surface the error to the
 * user — a silent success hides the very regressions this module exists to
 * detect.
 *
 * N-C (hardening, per Devin Review on PR #2):
 * The usual `getOfflineInspection` / `getRelatedDataOffline` helpers wrap
 * every IDB call in `withIndexedDBErrorBoundary`, which swallows errors and
 * returns fallback values (`null` / `[]`). That makes the N-C throw path
 * unreachable under real IDB failures — the verifier would just see a
 * "missing" parent or "empty" children and silently reapply, giving the
 * user a false success toast. We therefore call the purpose-built
 * `readParentStrict` / `readChildrenStrict` helpers exported from
 * `offline-storage`, which bypass the error boundary and let IDB throws
 * propagate into `RestoreVerificationError`.
 *
 * Extracted from DataRecoveryTool.tsx so the ZIP-import restore path
 * (local-backup-ledger.importBackupZip) can share the exact same guarantee.
 */

import type { ReportType } from '@/lib/local-backup-ledger';

export class RestoreVerificationError extends Error {
  readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'RestoreVerificationError';
    this.cause = cause;
  }
}

export interface VerifyRestoreIntegrityOptions {
  /**
   * N-B: expected child-row arrays keyed by child-store key
   * (e.g. 'systems' | 'ziplines' | 'equipment' for inspections). When
   * provided, the verifier re-reads each store for the restored report and
   * confirms membership + length match. A drift triggers the shared
   * `reapply` callback (so the caller must re-apply BOTH parent and
   * children on its re-apply path if children drift).
   */
  expectedChildren?: Record<string, Array<{ id?: string | null }> | undefined>;
}

export async function verifyRestoreIntegrity(
  reportType: ReportType,
  reportId: string,
  expectedParent: any,
  reapply: () => Promise<void>,
  options: VerifyRestoreIntegrityOptions = {},
): Promise<void> {
  const { readParentStrict, readChildrenStrict } = await import('@/lib/offline-storage');

  let live: any = null;
  try {
    live = await readParentStrict(reportType, reportId);
  } catch (err) {
    // N-C: parent read threw — surface to the caller. A silent "all good"
    // hides the exact class of failure this verifier exists to catch.
    throw new RestoreVerificationError(
      `[Restore Integrity] Parent re-read failed for ${reportType}/${reportId}`,
      err,
    );
  }

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

  // N-B: child drift detection.
  if (options.expectedChildren) {
    try {
      for (const [storeKey, expectedArr] of Object.entries(options.expectedChildren)) {
        if (!expectedArr) continue;
        const liveArr = (await readChildrenStrict(reportType, storeKey, reportId)) as Array<{ id?: string | null }>;
        const expectedIds = new Set(
          expectedArr.map((r) => r?.id).filter((id): id is string => typeof id === 'string' && id.length > 0),
        );
        const liveIds = new Set(
          liveArr.map((r) => r?.id).filter((id): id is string => typeof id === 'string' && id.length > 0),
        );
        if (liveArr.length !== expectedArr.length) {
          drift.push(`children:${storeKey}:count(${liveArr.length}!=${expectedArr.length})`);
          continue;
        }
        if (expectedIds.size > 0) {
          const missing: string[] = [];
          for (const id of expectedIds) if (!liveIds.has(id)) missing.push(id);
          if (missing.length > 0) {
            drift.push(`children:${storeKey}:missing(${missing.length})`);
          }
        }
      }
    } catch (err) {
      // N-C: child read threw — same policy as parent.
      throw new RestoreVerificationError(
        `[Restore Integrity] Child re-read failed for ${reportType}/${reportId}`,
        err,
      );
    }
  }

  if (drift.length > 0) {
    console.warn('[Restore Integrity] Field drift detected — re-applying', { reportType, reportId, drift });
    await reapply();
  }
}
