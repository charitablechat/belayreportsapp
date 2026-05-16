/**
 * Emergency Backup Rehydrator
 *
 * When the IndexedDB circuit breaker trips, `emergencyLocalStorageFallback`
 * writes the in-progress report to `localStorage` under `rw_backup_<type>_<id>`
 * with `synced: false`. The ledger-fallback path (`listUnsyncedDbRowsFromLedger`)
 * already feeds those snapshots into the sync pipeline, so data is never lost
 * — but the canonical IDB row stays missing until the user opens the form and
 * re-saves it.
 *
 * This module bridges that gap: once the per-store circuit breaker is closed
 * again, copy each unsynced emergency snapshot back into IDB under its
 * original id, *only when no row already exists there*. The rehydrated row
 * is saved via the normal `save*Offline` path so the dirty flag is set, the
 * tombstone semantics are preserved (we pass `explicitUserSave: false` so
 * we never clear a DROP tombstone), and the next sync cycle picks the row
 * up through the standard IDB reader.
 *
 * Idempotent and safe to call at the start of every sync cycle. No network
 * calls, no schema changes, no service-worker involvement.
 */

import {
  getCircuitBreakerStatus,
  getOfflineInspection,
  getOfflineTraining,
  getOfflineDailyAssessment,
  saveInspectionOffline,
  saveTrainingOffline,
  saveDailyAssessmentOffline,
} from './offline-storage';
import { listUnsyncedSnapshots, type ReportType } from './local-backup-ledger';

const STORE_BY_TYPE: Record<ReportType, 'inspections' | 'trainings' | 'daily_assessments'> = {
  inspection: 'inspections',
  training: 'trainings',
  daily_assessment: 'daily_assessments',
};

export interface RehydrationResult {
  type: ReportType;
  /** Snapshots successfully written back into IndexedDB. */
  rehydrated: number;
  /** Snapshots skipped because IDB already has a row for that id. */
  skipped: number;
  /** Snapshots skipped because the per-store breaker is still open. */
  breakerOpen: number;
  /** Snapshots that errored during the IDB write. */
  failed: number;
}

/**
 * Per-tab guard to avoid stampeding the IDB write path when multiple sync
 * cycles race (e.g. resume + interval + drain). The whole pass is fast and
 * already idempotent, but skipping in-flight reads is cheaper than
 * re-scanning localStorage.
 */
let rehydrationInFlight = false;

export async function rehydrateEmergencyBackupsToIdb(
  userId?: string | null,
): Promise<RehydrationResult[]> {
  if (rehydrationInFlight) return [];
  rehydrationInFlight = true;
  const status = getCircuitBreakerStatus();
  const results: RehydrationResult[] = [];

  try {
    for (const type of Object.keys(STORE_BY_TYPE) as ReportType[]) {
      const store = STORE_BY_TYPE[type];
      const breaker = status.byStore[store];
      const result: RehydrationResult = { type, rehydrated: 0, skipped: 0, breakerOpen: 0, failed: 0 };

      let snapshots: Array<{ reportId: string; snapshot: { parent?: Record<string, unknown> } }> = [];
      try {
        snapshots = listUnsyncedSnapshots(type, userId ?? undefined);
      } catch {
        // Ledger read should never throw, but never let a bad localStorage
        // entry crash the sync cycle.
        results.push(result);
        continue;
      }

      if (snapshots.length === 0) {
        results.push(result);
        continue;
      }

      // Per-store breaker check — we must NOT write to IDB while the store
      // is wedged or we'll just re-trip the breaker for no benefit.
      if (breaker?.open) {
        result.breakerOpen = snapshots.length;
        results.push(result);
        continue;
      }

      for (const { reportId, snapshot } of snapshots) {
        try {
          let existing: unknown = null;
          try {
            if (type === 'inspection') existing = await getOfflineInspection(reportId);
            else if (type === 'training') existing = await getOfflineTraining(reportId);
            else existing = await getOfflineDailyAssessment(reportId);
          } catch {
            existing = null; // Treat unreadable as missing — safest is to rehydrate.
          }

          if (existing) {
            result.skipped += 1;
            continue;
          }

          const row = { ...(snapshot.parent ?? {}), id: reportId } as Record<string, unknown> & {
            id: string;
          };

          // explicitUserSave:false so we don't clear a DROP tombstone the
          // user may have written between the emergency-save and now.
          // dispatchSyncEvent:false because the caller (sync loop) is about
          // to read unsynced rows anyway.
          if (type === 'inspection') {
            await saveInspectionOffline(row, { explicitUserSave: false, dispatchSyncEvent: false });
          } else if (type === 'training') {
            await saveTrainingOffline(row, { explicitUserSave: false, dispatchSyncEvent: false });
          } else {
            await saveDailyAssessmentOffline(row, { explicitUserSave: false, dispatchSyncEvent: false });
          }
          result.rehydrated += 1;
        } catch (e) {
          result.failed += 1;
          if (typeof console !== 'undefined') {
            console.warn('[Rehydrate] Failed to rehydrate emergency snapshot', {
              type,
              id: reportId.substring(0, 8),
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }

      if (result.rehydrated > 0) {
        console.log(
          `[Rehydrate] Restored ${result.rehydrated} ${type} emergency snapshot(s) to IndexedDB ` +
            `(skipped=${result.skipped}, failed=${result.failed})`,
        );
      }
      results.push(result);
    }
  } finally {
    rehydrationInFlight = false;
  }

  return results;
}

/**
 * Diagnostics helper: count unsynced emergency localStorage snapshots per
 * report type without any IDB or network access. Safe to call from any UI.
 */
export function countEmergencyBackups(userId?: string | null): Record<ReportType, number> {
  const out: Record<ReportType, number> = { inspection: 0, training: 0, daily_assessment: 0 };
  for (const type of Object.keys(out) as ReportType[]) {
    try {
      out[type] = listUnsyncedSnapshots(type, userId ?? undefined).length;
    } catch {
      // ignore
    }
  }
  return out;
}
