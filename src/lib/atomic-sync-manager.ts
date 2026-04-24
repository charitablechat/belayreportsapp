import { supabase } from "@/integrations/supabase/client";
import { syncLog } from "./sync-logger";
import {
  recordEmptyLocalConflict,
  shouldNotifyForEmptyLocalConflict,
  type EmptyLocalReportType,
} from "./empty-local-conflict-store";

/**
 * Build a user-facing label from a list of parts, skipping empty/nullish values.
 * Returns `fallback` when no usable parts remain so we never show " - " or a
 * leading separator.
 */
function formatProgressLabel(
  parts: Array<string | null | undefined>,
  fallback: string
): string {
  const cleaned = parts
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p.length > 0);
  return cleaned.length > 0 ? cleaned.join(' - ') : fallback;
}

/**
 * Resolve an organization id suitable for the `sync_conflicts` audit insert.
 * Prefers the row's own `organization_id`; falls back to a one-shot lookup
 * against `organizations` by name (case-insensitive) when only the legacy
 * text field is set. Returns null if neither resolves — caller should skip
 * the audit insert and warn.
 */
async function resolveOrgIdForAudit(inspection: {
  organization_id?: string | null;
  organization?: string | null;
}): Promise<string | null> {
  if (inspection.organization_id) return inspection.organization_id;
  const name = inspection.organization?.trim();
  if (!name) return null;
  try {
    const { data } = await supabase
      .from('organizations')
      .select('id')
      .ilike('name', name)
      .limit(1)
      .maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}
import { getUserWithCache, ensureValidSession, type CachedUser } from "@/lib/cached-auth";
import { isUnsafeToTransmit, looksLikeJwt } from "@/lib/synthetic-session-guard";
import { 
  getUnsyncedInspections,
  saveInspectionOffline,
  getOfflineInspection,
  getRelatedDataOffline,
  getRelatedDataOfflineWithStatus,
  saveRelatedDataOffline,
  clearRelatedDataOffline,
  getUnsyncedTrainings,
  saveTrainingOffline,
  getOfflineTraining,
  getTrainingDataOffline,
  getTrainingDataOfflineWithStatus,
  saveTrainingDataOffline,
  getUnsyncedDailyAssessments,
  saveDailyAssessmentOffline,
  getOfflineDailyAssessment,
  getAssessmentDataOffline,
  getAssessmentDataOfflineWithStatus,
  saveAssessmentDataOffline,
  relinkPhotosToNewInspectionId,
  clearTrainingDataOffline,
  clearAssessmentDataOffline,
  getQueuedTrainingOperations,
  removeQueuedTrainingOperation,
  getQueuedOperations,
  removeQueuedOperation,
  getQueuedAssessmentOperations,
  removeQueuedAssessmentOperation,
} from "./offline-storage";
import { 
  validateInspectionPackage,
} from "./validation-schemas";
import {
  validateTrainingPackage,
} from "./training-validation-schemas";
import {
  validateDailyAssessmentPackage,
} from "./daily-assessment-validation-schemas";
import { 
  executeTransaction,
  TransactionStep,
  fetchRollbackData
} from "./transaction-manager";
import { reconcileAllChildTables, restoreReconciledDeletions, type ReconciledTableDelete } from "./sync-reconciliation";
import { syncProgressEmitter } from "@/hooks/useSyncProgress";
import { getMobileCapabilities } from "./mobile-detection";
import { getCachedProfile } from "./profile-cache";
import {
  deleteOfflineInspection,
  deleteOfflineTraining,
  deleteOfflineDailyAssessment,
} from "./offline-storage";
import { appendVersion, getLatestFieldCount, calculateFieldCount } from "./report-version-manager";
import { runWithConcurrency } from "./concurrency";

// ─── C5 helper ──────────────────────────────────────────────────────────────
/**
 * C5: Pre-flight session validation for sync batches.
 *
 * Reads the current Supabase session and asserts the access_token is a real
 * JWT — not the offline placeholder (`offline_placeholder_token`). If the
 * placeholder token leaks into a sync batch, every Supabase request will 401,
 * dead-lettering otherwise-healthy records and exposing the placeholder string
 * in edge logs.
 *
 * Returns true if it's safe to proceed with sync, false otherwise.
 */
async function assertRealSessionForSync(ctx: string): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      console.warn(`[Atomic Sync] ${ctx}: no active session — aborting batch`);
      return false;
    }
    if (isUnsafeToTransmit(token, ctx)) {
      // isUnsafeToTransmit already logs in dev. Surface a user-visible toast
      // via the dynamic import to avoid pulling sonner into this module.
      try {
        const { toast } = await import('@/components/ui/sonner');
        toast.error('Session expired — please sign in again to sync your work', {
          id: 'sync-session-invalid',
          duration: 8000,
        });
      } catch { /* non-critical */ }
      return false;
    }
    if (!looksLikeJwt(token)) {
      console.warn(`[Atomic Sync] ${ctx}: access_token is not a valid JWT — aborting batch`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[Atomic Sync] ${ctx}: session check failed:`, err);
    // Fail open on read errors — let downstream session-validation do its job.
    return true;
  }
}

// ─── C1 helper ──────────────────────────────────────────────────────────────
type LiveGetter<T> = (id: string) => Promise<T | null | undefined>;
type LiveSaver<T>  = (record: T) => Promise<unknown>;

/**
 * C1: Post-sync save that won't clobber an auto-save that landed in IDB
 * during the server round-trip.
 *
 * - `t0Snapshot` is the parent record as captured at the start of sync.
 * - `t0UpdatedAtMs` is `Date.parse(t0Snapshot.updated_at)` (cache it once).
 * - If the live IDB record's updated_at is strictly newer than T0, we ONLY
 *   stamp `synced_at` on the live record and leave parent fields + updated_at
 *   intact — the next `getUnsynced*` cycle will correctly re-flag and upload
 *   the new edit instead of silently losing it.
 *
 * Any read/parse failure falls through to the legacy write so a guard-read
 * failure can never block sync completion.
 */
async function safePostSyncSave<T extends { id: string; updated_at?: string | null }>(
  recordId: string,
  t0Snapshot: T,
  t0UpdatedAtMs: number,
  serverTimestamp: string,
  mergedFields: Partial<T>,
  getLive: LiveGetter<T>,
  save: LiveSaver<T>,
): Promise<void> {
  let live: T | null | undefined = null;
  try { live = await getLive(recordId); } catch { live = null; }

  const liveUpdatedMs = live?.updated_at ? Date.parse(live.updated_at) : NaN;
  const concurrentEdit =
    Number.isFinite(liveUpdatedMs) &&
    Number.isFinite(t0UpdatedAtMs) &&
    liveUpdatedMs > t0UpdatedAtMs;

  if (concurrentEdit && live) {
    // C3: preserve `live.dirty` — a concurrent edit ran saveX Offline which
    // stamped dirty=true; we MUST NOT clear it or the next-cycle unsynced
    // filter will skip the new edit. Spread `live` last so its dirty flag wins.
    await save({ ...live, synced_at: serverTimestamp } as T);
    if (import.meta.env.DEV) {
      syncLog.log('[C1] Concurrent edit detected — preserved live record, stamped synced_at only', {
        id: recordId.substring(0, 8),
        t0: new Date(t0UpdatedAtMs).toISOString(),
        live: live.updated_at,
      });
    }
    return;
  }

  // C3: preserve a higher local updated_at if the device clock was ahead of
  // the server. Flattening to serverTimestamp would zero out drift and let
  // getUnsynced* falsely flag the record clean even when local edits exist.
  const t0UpdatedIso = (t0Snapshot as { updated_at?: string | null }).updated_at;
  const t0Ms = t0UpdatedIso ? Date.parse(t0UpdatedIso) : NaN;
  const serverMs = Date.parse(serverTimestamp);
  const mergedUpdatedAt =
    Number.isFinite(t0Ms) && Number.isFinite(serverMs) && t0Ms > serverMs
      ? t0UpdatedIso!
      : serverTimestamp;

  // C3 (dirty-flag): no concurrent edit was detected, so this commit really
  // does represent every unshipped change. Clear `dirty` so the next-cycle
  // unsynced filter doesn't re-pick this record. If the device clock ran
  // ahead and we kept the local updated_at, we leave dirty cleared anyway —
  // the drift-tolerance check is the secondary safety net for that edge.
  await save({
    ...t0Snapshot,
    ...mergedFields,
    synced_at: serverTimestamp,
    updated_at: mergedUpdatedAt,
    dirty: false,
  } as T);

  if (import.meta.env.DEV && mergedUpdatedAt !== serverTimestamp) {
    syncLog.log('[C3] T0.updated_at > serverTimestamp — preserved local timestamp', {
      id: recordId.substring(0, 8),
      t0: t0UpdatedIso,
      server: serverTimestamp,
    });
  }
}
import { assertNoTempIds, assertNoTempIdsInArray } from "./sw-sync-validators";
import { registerSelfWrite, emitRemoteDeletedConflict } from "./sync-events";
import { quarantineRecord } from "./offline-storage";
import {
  getRegressionSkipCount,
  incrementRegressionSkipCount,
  resetRegressionSkipCount,
} from "./regression-skip-store";
import { wasClearedAfterLastSync } from "./clear-intent";
import { mergeRecordFields, TRACKED_FIELDS } from "./field-merge";
import { SYNC_DRIFT_TOLERANCE_MS } from "./local-data-guards";

/**
 * H4: Field-merge gate. We no longer use a `timeDiff > 30s` window — that
 * created a silent-overwrite blind spot where two devices editing within
 * ~30s of each other would skip the merge entirely and let the local upsert
 * clobber remote-only field edits. Instead, we trigger the merge whenever
 * the remote `updated_at` is strictly newer than our last successful sync
 * (with `SYNC_DRIFT_TOLERANCE_MS` absorbing benign server/client clock skew).
 *
 * `mergeRecordFields` is idempotent and safe to run on identical inputs, so
 * over-triggering only costs an extra `select *` round-trip; under-triggering
 * costs data.
 */

/**
 * Adaptive batch size for sync cycles.
 * Starts at MIN_BATCH_SIZE; after each cycle that completes with zero failures
 * we ramp up to MAX_BATCH_SIZE. Any failure resets back to MIN_BATCH_SIZE.
 * This drains a backlog of 22 reports in ~2 cycles instead of ~5 while still
 * protecting timeout budgets when the network is unhealthy.
 */
const MIN_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 20; // exported for back-compat with useAutoSync timeout calc
let currentBatchSize = MIN_BATCH_SIZE;
function getCurrentBatchSize(): number { return currentBatchSize; }
export function noteBatchOutcome(failed: number): void {
  if (failed > 0) {
    currentBatchSize = MIN_BATCH_SIZE;
  } else {
    currentBatchSize = Math.min(MAX_BATCH_SIZE, currentBatchSize + 5);
  }
}
export function getAdaptiveBatchSize(): number { return currentBatchSize; }

/**
 * Tracks consecutive field_count_regression skips per record.
 * After MAX_REGRESSION_SKIPS consecutive skips, the guard allows sync to proceed.
 * This prevents legitimate large deletions from being blocked indefinitely.
 *
 * S10: counter is now persisted via regression-skip-store.ts so it survives
 * tab refresh / PWA wake / SW restart. The helpers there maintain an in-memory
 * hot cache; we just call them directly.
 */
export const MAX_REGRESSION_SKIPS = 3;

/**
 * S39: Notify the in-app notification center the first time a record is blocked
 * by the regression guard, and dispatch a `sync-records-updated` event so any
 * subscribed UI (SyncDiagnosticsSheet, SyncPulse via useUnsyncedPhotos) can
 * refresh its held-back list. Best-effort — never throws into sync hot path.
 */
function notifyRegressionBlock(
  kind: 'inspection' | 'training' | 'assessment',
  recordId: string,
  label: string,
  skipCount: number,
): void {
  try {
    window.dispatchEvent(new CustomEvent('sync-records-updated'));
  } catch {
    /* ignore */
  }
  if (skipCount !== 1) return; // only on first block in a chain
  void import('./notification-center')
    .then(({ addWarningNotification }) => {
      const safeLabel = label?.trim() || `${kind} ${recordId.substring(0, 8)}`;
      addWarningNotification(
        `Sync paused: ${safeLabel} — large drop in data detected (auto-resumes after ${MAX_REGRESSION_SKIPS} cycles)`,
      );
    })
    .catch(() => {});
}

function notifyRegressionRelease(): void {
  try {
    window.dispatchEvent(new CustomEvent('sync-records-updated'));
  } catch {
    /* ignore */
  }
}

/**
 * C2: Record an empty-local-guard conflict and, on first detection, surface a
 * user-visible warning so the user can resolve it from SyncDiagnosticsSheet.
 * Best-effort — never throws into the sync hot path.
 */
function recordEmptyLocalConflictAndNotify(
  reportType: EmptyLocalReportType,
  recordId: string,
  serverCounts: Record<string, number>,
  organizationLabel: string | undefined,
): void {
  void recordEmptyLocalConflict({
    id: recordId,
    reportType,
    detectedAt: Date.now(),
    serverCounts,
    organizationLabel,
  }).catch(() => {});

  try {
    window.dispatchEvent(new CustomEvent('sync-records-updated'));
  } catch {
    /* ignore */
  }

  if (!shouldNotifyForEmptyLocalConflict(recordId)) return;
  void import('./notification-center')
    .then(({ addWarningNotification }) => {
      const safeLabel =
        organizationLabel?.trim() || `${reportType} ${recordId.substring(0, 8)}`;
      addWarningNotification(
        `Sync paused: ${safeLabel} — local cache is empty but server has data. Open Sync Diagnostics to resolve.`,
      );
    })
    .catch(() => {});
}

/**
 * Interface for record status returned by check_record_status RPC
 * Used to bypass RLS and check if a record was soft-deleted
 */
interface RecordStatus {
  record_exists: boolean;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
  updated_at: string | null;
  synced_at: string | null;
}

/**
 * Check remote record status using RLS-bypassing RPC function
 * This allows detecting soft-deleted records that regular users can't see via normal SELECT
 * 
 * @param tableName - The table to check ('inspections' | 'trainings' | 'daily_assessments')
 * @param recordId - The UUID of the record to check
 * @returns RecordStatus or null if record doesn't exist or error occurred
 */
async function checkRemoteRecordStatus(
  tableName: 'inspections' | 'trainings' | 'daily_assessments',
  recordId: string
): Promise<RecordStatus | null> {
  try {
    const { data, error } = await supabase
      .rpc('check_record_status', {
        p_table_name: tableName,
        p_record_id: recordId
      })
      .maybeSingle();
    
    if (error) {
      console.error('[Atomic Sync] Error checking record status:', error);
      return null;
    }
    
    return data as RecordStatus | null;
  } catch (e) {
    console.error('[Atomic Sync] Exception checking record status:', e);
    return null;
  }
}

/**
 * C9: Handle a sync-time detection of `remote_deleted` for a parent record.
 *
 * Behavior:
 * - If the local record has unsynced edits (synced_at < updated_at, or never
 *   synced), QUARANTINE the local row in IDB (set `_remote_deleted_at` and
 *   `_quarantine_reason`) and emit a `remote-deleted-conflict` event for the
 *   UI to surface RemoteDeletedConflictDialog. Children are NOT touched.
 * - If the local record has no unsynced edits, the local copy already matches
 *   the server's pre-delete state — safe to hard-delete locally as before
 *   (no version-ring snapshot needed; nothing to recover).
 *
 * Returns `{ quarantined: true }` when we held the local data, or
 * `{ quarantined: false }` when we performed the legacy hard-delete.
 */
async function handleRemoteDeleted(
  table: 'inspections' | 'trainings' | 'daily_assessments',
  recordId: string,
  localRecord: { synced_at?: string | null; updated_at?: string | null; organization?: string | null } | null,
  remoteDeletedAt: string,
  legacyHardDelete: () => Promise<void>,
): Promise<{ quarantined: boolean }> {
  const hasUnsyncedEdits = (() => {
    if (!localRecord) return false;
    if (!localRecord.synced_at) return true;
    const upd = localRecord.updated_at ? Date.parse(localRecord.updated_at) : NaN;
    const syn = Date.parse(localRecord.synced_at);
    if (!Number.isFinite(upd) || !Number.isFinite(syn)) return false;
    return upd > syn;
  })();

  if (hasUnsyncedEdits) {
    const ok = await quarantineRecord(table, recordId, remoteDeletedAt, 'remote_soft_delete');
    if (ok) {
      emitRemoteDeletedConflict({
        table,
        recordId,
        remoteDeletedAt,
        organizationLabel: localRecord?.organization ?? null,
      });
      syncLog.log('[C9] Quarantined local record with unsynced edits (remote was deleted):', {
        table,
        id: recordId.substring(0, 8),
      });
      return { quarantined: true };
    }
    // Quarantine failed (record vanished mid-flight) — fall through to legacy.
  }

  try {
    await legacyHardDelete();
    syncLog.log('[Atomic Sync] Cleaned up local copy for remote-deleted record (no unsynced edits):', {
      table,
      id: recordId.substring(0, 8),
    });
  } catch (err) {
    console.error('[Atomic Sync] Failed to clean up orphaned local data:', err);
  }
  return { quarantined: false };
}

/**
 * Sync inspection with all related data atomically
 */
export async function syncInspectionAtomic(inspectionId: string, preValidatedUser?: CachedUser, signal?: AbortSignal) {
  if (signal?.aborted) return { success: false, skipped: true, reason: 'aborted' as const };
  if (!navigator.onLine) {
    throw new Error("Cannot sync while offline");
  }
  
  // Track temp-to-UUID mapping for post-sync IndexedDB cleanup
  let inspectionIdMapping: { oldId: string; newId: string } | null = null;
  
  try {
    // S32: Serialize per-item child reads to avoid Safari/iOS IDB lock contention
    // (6 concurrent reads × N items reliably triggered withIDBTimeout fallbacks).
    // Outer loop is already one-item-at-a-time, so total in-flight reads = 1.
    const inspection = await getOfflineInspection(inspectionId);
    const systemsRead = await getRelatedDataOfflineWithStatus('systems', inspectionId);
    const ziplinesRead = await getRelatedDataOfflineWithStatus('ziplines', inspectionId);
    const equipmentRead = await getRelatedDataOfflineWithStatus('equipment', inspectionId);
    const standardsRead = await getRelatedDataOfflineWithStatus('standards', inspectionId);
    const summaryRead = await getRelatedDataOfflineWithStatus('summary', inspectionId);
    if (!inspection) {
      throw new Error("Inspection not found in local storage");
    }
    // C1: capture T0 updated_at for concurrent-edit detection at post-sync save.
    const inspectionT0UpdatedAtMs = inspection.updated_at ? Date.parse(inspection.updated_at) : NaN;
    
    // Detect and replace temp inspection IDs with real UUIDs before validation
    if (inspection.id.startsWith('temp-')) {
      // S5: DEDUP via stable client_idempotency_key (server-enforced via partial unique index).
      // Falls back to deriving the key from the temp id for legacy temp records that
      // were created before this column existed.
      const idempKey = (inspection as any).client_idempotency_key
        ?? inspection.id.replace(/^temp-/, '');

      const { data: dupRows } = await supabase
        .from('inspections')
        .select('id')
        .eq('inspector_id', inspection.inspector_id)
        .eq('client_idempotency_key', idempKey)
        .limit(2);

      if (dupRows && dupRows.length > 0) {
        if (dupRows.length > 1) {
          console.warn('[Atomic Sync] Multiple server rows share idempotency key — adopting first, manual cleanup needed', {
            idempKey, ids: dupRows.map(r => r.id),
          });
        }
        const serverId = dupRows[0].id;
        syncLog.log('[Atomic Sync] Found existing server record for temp inspection - adopting ID:', {
          tempId: inspection.id,
          serverId,
        });
        inspectionIdMapping = { oldId: inspection.id, newId: serverId };
        inspection.id = serverId;
        inspectionId = serverId;
      } else {
        const newId = crypto.randomUUID();
        inspectionIdMapping = { oldId: inspection.id, newId };
        syncLog.log('[Atomic Sync] Replacing temp inspection ID with real UUID:', {
          oldId: inspection.id,
          newId,
        });
        inspection.id = newId;
        inspectionId = newId;
      }

      // Always carry the idempotency key forward into the upsert payload.
      (inspection as any).client_idempotency_key = idempKey;
    }
    
    // Use pre-validated user from batch caller, or validate session if called individually
    const user = preValidatedUser || await ensureValidSession();
    if (!user) {
      console.error('[Atomic Sync] No valid session - sync aborted for inspection:', inspectionId);
      // THROW instead of returning silently so caller counts this as a failure
      throw new Error('No valid session for sync');
    }
    
    // Auto-fix ownership for locally-created records, skip only for server-origin records
    if (inspection.inspector_id !== user.id) {
      if (!inspection.synced_at) {
        syncLog.log('[Atomic Sync] Auto-fixing inspector_id for local inspection:', {
          inspectionId,
          oldInspectorId: inspection.inspector_id?.substring(0, 8),
          newInspectorId: user.id.substring(0, 8),
        });
        inspection.inspector_id = user.id;
        await saveInspectionOffline(inspection);
      } else {
        console.warn('[Atomic Sync] Skipping inspection - belongs to different user', {
          inspection_id: inspectionId,
        });
        return { success: false, skipped: true, reason: 'ownership_mismatch' };
      }
    }
    
    const rawSystems = systemsRead.items;
    const rawZiplines = ziplinesRead.items;
    const rawEquipment = equipmentRead.items;
    const rawStandards = standardsRead.items;
    const summaryArray = summaryRead.items;
    const idbReadFlags = {
      systems: systemsRead.readSucceeded,
      ziplines: ziplinesRead.readSucceeded,
      equipment: equipmentRead.readSucceeded,
      standards: standardsRead.readSucceeded,
      summary: summaryRead.readSucceeded,
    };
    
    let rawSummary = summaryArray[0] || null;
    
    // If we swapped the inspection ID, propagate new ID to all child records
    if (inspectionIdMapping) {
      const updateChildInspectionId = (items: any[]) =>
        items.map(item => ({
          ...item,
          inspection_id: inspectionIdMapping!.newId,
        }));
      
      rawSystems.forEach(item => item.inspection_id = inspectionIdMapping!.newId);
      rawZiplines.forEach(item => item.inspection_id = inspectionIdMapping!.newId);
      rawEquipment.forEach(item => item.inspection_id = inspectionIdMapping!.newId);
      rawStandards.forEach(item => item.inspection_id = inspectionIdMapping!.newId);
      if (rawSummary) {
        rawSummary = { ...rawSummary, inspection_id: inspectionIdMapping.newId };
      }
    }
    
    // Transform temp- IDs to valid UUIDs before validation
    // These temp IDs are created in the UI for new rows but need real UUIDs for DB
    const transformTempIds = <T extends { id?: string }>(items: T[]): T[] => {
      return items.map(item => ({
        ...item,
        id: item.id?.startsWith('temp-') ? crypto.randomUUID() : item.id
      }));
    };
    
    const systems = transformTempIds(rawSystems);
    const ziplines = transformTempIds(rawZiplines);
    const equipment = transformTempIds(rawEquipment);
    const standards = transformTempIds(rawStandards);
    const summary = rawSummary?.id?.startsWith('temp-') 
      ? { ...rawSummary, id: crypto.randomUUID() } 
      : rawSummary;
    
    // 2. Validate the complete package
    const validation = validateInspectionPackage({
      inspection,
      systems,
      ziplines,
      equipment,
      standards,
      summary,
    });
    
    if (!validation.success) {
      console.error('[Atomic Sync] Validation failed:', validation.errors);
      throw new Error(`Validation failed: ${JSON.stringify(validation.errors)}`);
    }
    
    if (import.meta.env.DEV) {
      syncLog.log('[Atomic Sync] Validation passed for:', inspectionId);
    }
    
    // RC-5: Skip remote status check for new records (no synced_at = never been on server)
    // This eliminates ~6 network requests per new record (status check + 5 rollback fetches)
    const isNewRecord = !inspection.synced_at;
    const recordStatus = isNewRecord ? null : await checkRemoteRecordStatus('inspections', inspectionId);
    
    // C9: Remote record was soft-deleted. If we have unsynced local edits,
    // quarantine instead of wiping — the user resolves via dialog.
    if (recordStatus?.record_exists && recordStatus?.is_deleted) {
      const remoteDeletedAt = recordStatus.deleted_at ?? new Date().toISOString();
      const result = await handleRemoteDeleted(
        'inspections',
        inspectionId,
        inspection,
        remoteDeletedAt,
        async () => {
          // Legacy hard-delete path: only runs when there are no unsynced edits.
          // No version snapshot needed — local matches server's pre-delete state.
          await deleteOfflineInspection(inspectionId);
        },
      );
      return {
        success: false,
        skipped: true,
        reason: 'remote_deleted' as const,
        quarantined: result.quarantined,
        message: result.quarantined
          ? 'This record was deleted by an administrator while you had unsynced changes. Resolve in the conflict dialog.'
          : 'This record was deleted by an administrator. Local copy has been cleaned up.',
      };
    }
    
    // S16: Field-level merge instead of row-level last-writer-wins.
    // When remote has changes our last sync didn't see, fetch the full remote
    // row and merge per-field by `field_timestamps`. The merged record then
    // flows through the normal sync path (so child reconciliation still runs).
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      const remoteUpdated = new Date(recordStatus.updated_at!).getTime();
      const localSyncedAt = inspection.synced_at ? new Date(inspection.synced_at).getTime() : 0;
      // H4: merge whenever remote could plausibly have changed since our last
      // sync. SYNC_DRIFT_TOLERANCE_MS absorbs benign server/client clock skew
      // without re-introducing a silent-overwrite blind spot.
      const remoteChangedSinceOurSync =
        localSyncedAt === 0 || remoteUpdated > localSyncedAt + SYNC_DRIFT_TOLERANCE_MS;

      if (remoteChangedSinceOurSync) {
        const { data: remoteRow } = await supabase
          .from('inspections')
          .select('*')
          .eq('id', inspectionId)
          .maybeSingle();

        if (remoteRow) {
          const merged = mergeRecordFields<any>(
            inspection as any,
            remoteRow as any,
            TRACKED_FIELDS.inspection,
          );
          // Mutate in place so the existing transaction steps below upsert merged values.
          Object.assign(inspection, merged);

          if (import.meta.env.DEV) {
            syncLog.log('[Atomic Sync] S16 field-merged inspection:', inspectionId);
          }

          // Audit: log resolved conflict so the conflicts panel reflects the merge.
          const organizationId = await resolveOrgIdForAudit(inspection);
          if (organizationId) {
            try {
              await supabase.from('sync_conflicts').insert({
                inspection_id: inspectionId,
                organization_id: organizationId,
                local_updated_at: inspection.updated_at,
                remote_updated_at: recordStatus.updated_at!,
                resolved: true,
              });
            } catch (auditErr) {
              console.warn('[Atomic Sync] S16 conflict audit insert failed:', auditErr);
            }
          } else {
            console.warn(
              '[Atomic Sync] sync_conflicts audit skipped: missing organization_id',
              { inspectionId },
            );
          }
        }
      }
    }
    // PRE-SYNC VERSION SNAPSHOT — capture immutable state before sync
    appendVersion('inspection', inspectionId, inspection, {
      systems, ziplines, equipment, standards, summary: summary ? [summary] : [],
    }, 'pre_sync').catch(() => {});

    // FIELD-COUNT REGRESSION GUARD — block sync if local data regressed significantly
    const currentFieldCount = calculateFieldCount(inspection, {
      systems, ziplines, equipment, standards, summary: summary ? [summary] : [],
    });
    const previousFieldCount = await getLatestFieldCount(inspectionId);
    if (previousFieldCount !== null && previousFieldCount > 0) {
      const dropPercent = ((previousFieldCount - currentFieldCount) / previousFieldCount) * 100;
      if (dropPercent > 50) {
        const skipCount = await incrementRegressionSkipCount(inspectionId);
        if (skipCount <= MAX_REGRESSION_SKIPS) {
          console.error('[SAFETY] Blocked inspection sync: field count regression >50%', {
            inspectionId: inspectionId.substring(0, 8),
            previousFieldCount,
            currentFieldCount,
            dropPercent: dropPercent.toFixed(1),
            skipCount,
            maxSkips: MAX_REGRESSION_SKIPS,
          });
          notifyRegressionBlock(
            'inspection',
            inspectionId,
            (inspection as any)?.organization || (inspection as any)?.location || '',
            skipCount,
          );
          return { success: false, skipped: true, reason: 'field_count_regression' };
        }
        console.warn('[SAFETY] Allowing inspection sync after max regression skips reached', {
          inspectionId: inspectionId.substring(0, 8),
          skipCount,
        });
        await resetRegressionSkipCount(inspectionId);
        notifyRegressionRelease();
      } else {
        // Field count is healthy — clear any previous skip counter
        await resetRegressionSkipCount(inspectionId);
        notifyRegressionRelease();
      }
    }

    // M15: Hard guard — fail loud if any temp- ID slipped past the transforms above.
    assertNoTempIds(inspection, 'inspections.upsert');
    assertNoTempIdsInArray(systems, 'inspection_systems.upsert');
    assertNoTempIdsInArray(ziplines, 'inspection_ziplines.upsert');
    assertNoTempIdsInArray(equipment, 'inspection_equipment.upsert');
    assertNoTempIdsInArray(standards, 'inspection_standards.upsert');
    if (summary) assertNoTempIds(summary, 'inspection_summary.upsert');

    // 4. Build transaction steps
    const steps: TransactionStep[] = [];
    
    // Exclude joined 'inspector' object - only inspector_id column exists in DB
    const { inspector, ...inspectionWithoutJoin } = inspection as any;
    
    // For rollback, capture both synced_at and updated_at for proper state restoration
    const rollbackData = recordStatus?.record_exists 
      ? { synced_at: recordStatus.synced_at, updated_at: recordStatus.updated_at } 
      : null;
    
    // Step 1: Upsert inspection WITHOUT setting synced_at (defer to final step)
    // This ensures synced_at is only set after ALL related data is committed
    steps.push({
      table: 'inspections',
      operation: 'upsert',
      data: {
        ...inspectionWithoutJoin,
        // DO NOT set synced_at here - it will be set in the final step
      },
      rollbackData,
    });
    
    // ZERO DATA LOSS: Empty-array safeguard
    // If the server has child data but local is completely empty, this is suspicious
    // (likely IndexedDB corruption or failed read) -- skip sync to prevent data loss
    let existingSystems: any[] = [];
    let existingZiplines: any[] = [];
    let existingEquipment: any[] = [];
    let existingStandards: any[] = [];
    let existingSummary: any[] = [];

    // S25: When the server row is at exactly our last-known baseline, skip the
    // 5x rollback pre-fetch. reconcileChildTable will fall back to its own
    // single-table fetch only if it actually needs to compute a delete; the
    // empty-local-guard here only matters when server has child data we don't
    // know about, which can't be the case if updated_at hasn't moved.
    // Trade-off: rollbackData is missing for mid-transaction failures, but
    // synced_at won't advance unless the final step succeeds, so the next
    // cycle re-syncs idempotently against the same upsert IDs.
    const serverUnchangedSinceBaseline =
      !!inspection.synced_at &&
      !!recordStatus?.updated_at &&
      recordStatus.updated_at === inspection.synced_at;

    if (recordStatus?.record_exists && !recordStatus?.is_deleted && !serverUnchangedSinceBaseline) {
      [
        existingSystems,
        existingZiplines,
        existingEquipment,
        existingStandards,
        existingSummary
      ] = await Promise.all([
        fetchRollbackData('inspection_systems', { inspection_id: inspectionId }),
        fetchRollbackData('inspection_ziplines', { inspection_id: inspectionId }),
        fetchRollbackData('inspection_equipment', { inspection_id: inspectionId }),
        fetchRollbackData('inspection_standards', { inspection_id: inspectionId }),
        fetchRollbackData('inspection_summary', { inspection_id: inspectionId }),
      ]);
      
      const serverHasChildData = existingSystems.length > 0 || existingZiplines.length > 0 || 
        existingEquipment.length > 0 || existingStandards.length > 0 || existingSummary.length > 0;
      const localIsCompletelyEmpty = systems.length === 0 && ziplines.length === 0 && 
        equipment.length === 0 && standards.length === 0 && !summary;
      
      if (serverHasChildData && localIsCompletelyEmpty && !wasClearedAfterLastSync(inspection)) {
        const serverCounts = {
          systems: existingSystems.length,
          ziplines: existingZiplines.length,
          equipment: existingEquipment.length,
          standards: existingStandards.length,
          summary: existingSummary.length,
        };
        console.warn('[SAFETY] empty_local_guard: server has child data but local is empty', {
          inspectionId,
          serverCounts,
        });

        // C2: Do NOT auto-restore server data into IDB — that silently reverts
        // intentional user deletions in races (debounced autosave still in
        // flight, cross-tab clears, etc.). Instead, record a user-resolvable
        // conflict and skip. The user picks Restore / Confirm-empty / Dismiss
        // from SyncDiagnosticsSheet.
        recordEmptyLocalConflictAndNotify(
          'inspection',
          inspectionId,
          serverCounts,
          inspection.organization || (inspection as any).location || undefined,
        );

        return { success: false, skipped: true, reason: 'empty_local_guard' };
      }
    }
    
    // SUSPICIOUS EMPTY GUARD: If record has been edited but ALL child data is empty,
    // this likely means IndexedDB reads failed silently. Skip sync to prevent marking as complete.
    // This complements the empty_local_guard above (which only fires when server already has data).
    {
      const localIsCompletelyEmpty = systems.length === 0 && ziplines.length === 0 && 
        equipment.length === 0 && standards.length === 0 && !summary;
      const createdAt = new Date(inspection.created_at || inspection.updated_at).getTime();
      const updatedAt = new Date(inspection.updated_at).getTime();
      const ageMinutes = (Date.now() - createdAt) / 60000;
      const wasEdited = (updatedAt - createdAt) > 60000; // edited if updated > 60s after creation

      if (localIsCompletelyEmpty && wasEdited && ageMinutes > 5) {
        // M4: If EVERY child IDB read failed, this empty payload is not real —
        // it's a circuit-breaker / silent-IDB-failure fingerprint. Refuse to
        // sync so we don't overwrite the server's canonical state with zeros.
        const allIdbReadsFailed =
          !idbReadFlags.systems &&
          !idbReadFlags.ziplines &&
          !idbReadFlags.equipment &&
          !idbReadFlags.standards &&
          !idbReadFlags.summary;
        if (allIdbReadsFailed) {
          console.warn('[SAFETY] suspicious_empty_guard: all IDB child reads failed, skipping inspection sync', {
            inspectionId: inspectionId.substring(0, 8),
            ageMinutes: Math.round(ageMinutes),
          });
          return { success: false, skipped: true, reason: 'suspicious_empty_idb_read_failure' };
        }
        if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
          // Guard 1 already ran and didn't block — server is also empty. Allow sync.
          syncLog.log('[SYNC] suspicious_empty_guard: both local and server are empty, allowing sync for genuinely blank inspection', {
            inspectionId: inspectionId.substring(0, 8),
          });
        } else {
          // Record doesn't exist on server yet — new blank form, allow sync
          syncLog.log('[SYNC] suspicious_empty_guard: new inspection with no server data, allowing sync', {
            inspectionId: inspectionId.substring(0, 8),
          });
        }
      }
    }

    // Step 2: UPSERT child data first; reconcile (DELETE) is DEFERRED until
    // after the transaction commits (H3). The reconcile spec is captured here
    // so we can use the same prefetched server snapshots and IDB read flags.
    let inspectionReconcileSpec: import('./deferred-reconcile').DeferredReconcileSpec[] | null = null;
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      // S25: when prefetch was skipped, pass `undefined` (not `[]`) so
      // reconcileChildTable falls back to its own live fetch when needed.
      const pf = (arr: any[]) => (serverUnchangedSinceBaseline ? undefined : arr);
      inspectionReconcileSpec = [
        { childTable: 'inspection_systems', parentIdColumn: 'inspection_id', localItems: systems, prefetchedServerRows: pf(existingSystems), expectedNonEmpty: idbReadFlags.systems },
        { childTable: 'inspection_ziplines', parentIdColumn: 'inspection_id', localItems: ziplines, prefetchedServerRows: pf(existingZiplines), expectedNonEmpty: idbReadFlags.ziplines },
        { childTable: 'inspection_equipment', parentIdColumn: 'inspection_id', localItems: equipment, prefetchedServerRows: pf(existingEquipment), expectedNonEmpty: idbReadFlags.equipment },
        { childTable: 'inspection_standards', parentIdColumn: 'inspection_id', localItems: standards, prefetchedServerRows: pf(existingStandards), expectedNonEmpty: idbReadFlags.standards },
        { childTable: 'inspection_summary', parentIdColumn: 'inspection_id', localItems: summary ? [summary] : [], prefetchedServerRows: pf(existingSummary), expectedNonEmpty: idbReadFlags.summary },
      ];
    }

    if (systems.length > 0) {
      steps.push({
        table: 'inspection_systems',
        operation: 'upsert',
        data: systems,
        rollbackData: existingSystems,
      });
    }
    
    if (ziplines.length > 0) {
      steps.push({
        table: 'inspection_ziplines',
        operation: 'upsert',
        data: ziplines,
        rollbackData: existingZiplines,
      });
    }
    
    if (equipment.length > 0) {
      steps.push({
        table: 'inspection_equipment',
        operation: 'upsert',
        data: equipment,
        rollbackData: existingEquipment,
      });
    }
    
    if (standards.length > 0) {
      steps.push({
        table: 'inspection_standards',
        operation: 'upsert',
        data: standards,
        rollbackData: existingStandards,
      });
    }
    
    if (summary) {
      // Sanitize summary before sync - convert empty strings to null for date fields
      const sanitizedSummary = {
        ...summary,
        next_inspection_date: summary.next_inspection_date === "" ? null : summary.next_inspection_date
      };
      
      steps.push({
        table: 'inspection_summary',
        operation: 'upsert',
        data: [sanitizedSummary],
        rollbackData: existingSummary,
      });
    }
    
    // FINAL STEP: Set synced_at ONLY after all related data is successfully inserted
    // This is the atomic guarantee - synced_at only updates when everything commits
    steps.push({
      table: 'inspections',
      operation: 'update',
      data: { synced_at: new Date().toISOString(), last_sync_source: 'main_thread' },
      filter: { id: inspectionId },
    });
    
    // 5. Execute transaction
    // S6: register self-write so the Realtime handler doesn't re-trigger sync from our own writes
    registerSelfWrite(inspectionId);
    const result = await executeTransaction(steps, { signal });
    
    if (!result.success) {
      // H3: nothing to compensate — reconcile is now deferred until AFTER the
      // transaction commits, so a failed upsert leaves the server untouched.
      throw new Error(`Transaction failed after ${result.completedSteps}/${result.totalSteps} steps. Rollback: ${result.rollbackSuccess ? 'successful' : 'failed'}`);
    }

    // H3: Now that parent + children are safely on the server, run reconcile.
    // If reconcile is blocked or fails, the user's deletions remain unflushed
    // locally and the next sync cycle retries — no destructive server side-effect.
    let inspectionReconcileBlocked = false;
    if (inspectionReconcileSpec) {
      const { runDeferredReconcile } = await import('./deferred-reconcile');
      const outcome = await runDeferredReconcile(
        inspectionReconcileSpec,
        inspectionId,
        'inspection',
        user.id,
      );
      inspectionReconcileBlocked = outcome.result?.blocked === true || !outcome.ran;
    }
    
    // S4: Skip post-transaction verify SELECT — `executeTransaction` already throws on
    // 0-affected-row writes, and `align_synced_at` below errors loudly if the row is missing.
    
    // 6. Get cached inspector profile to attach to offline data
    const inspectorProfile = await getCachedProfile(user.id);
    
    // POST-SYNC ALIGNMENT: Call align_synced_at RPC to set synced_at = updated_at on server
    // The updated trigger now preserves updated_at for metadata-only changes,
    // and this RPC ensures synced_at >= updated_at, eliminating the re-sync race condition.
    registerSelfWrite(inspectionId); // S6: align_synced_at is a separate server write
    const { data: aligned, error: alignError } = await supabase.rpc('align_synced_at', {
      p_table_name: 'inspections',
      p_record_id: inspectionId,
    });

    // S3: align_synced_at is ADVISORY. The transaction's final step already wrote
    // synced_at on the server (executeTransaction enforces row-count > 0).
    // S14: on RPC failure, do one extra SELECT for the server-authoritative
    // updated_at/synced_at — the client-clock fallback was the source of the
    // "1 pending" drift trap on slow networks.
    let serverTimestamp: string;
    const alignedData = aligned as any;
    if (alignError || !alignedData || alignedData.error) {
      console.warn(
        '[Atomic Sync] align_synced_at non-fatal failure — fetching server timestamp',
        { table: 'inspections', id: inspectionId, alignError: alignError?.message, aligned }
      );
      const { data: serverRow } = await supabase
        .from('inspections')
        .select('updated_at, synced_at')
        .eq('id', inspectionId)
        .maybeSingle();
      serverTimestamp =
        (serverRow as any)?.synced_at ||
        (serverRow as any)?.updated_at ||
        (steps[steps.length - 1].data as any).synced_at;
    } else {
      serverTimestamp = alignedData.updated_at;
      syncLog.log(
        '%c[SYNC_TERMINAL] align_synced_at CONFIRMED %c%s',
        'color: #4ade80; font-family: monospace; font-weight: bold',
        'color: #86efac; font-family: monospace',
        `| table=inspections | id=${inspectionId.substring(0,8)}... | ts=${serverTimestamp}`
      );
    }
    
    // C1: guard against clobbering an auto-save that landed during the round-trip.
    // mergedFields below mirrors the original spread (S9: clear user_cleared_at, attach inspector).
    await safePostSyncSave(
      inspectionId,
      inspection,
      inspectionT0UpdatedAtMs,
      serverTimestamp,
      {
        user_cleared_at: null,
        inspector: inspectorProfile || { first_name: null, last_name: null, avatar_url: null },
      } as any,
      getOfflineInspection,
      saveInspectionOffline,
    );
    
    // 7. If we swapped a temp ID, clean up old IndexedDB entries
    if (inspectionIdMapping) {
      syncLog.log('[Atomic Sync] Cleaning up old temp-ID entries from IndexedDB:', inspectionIdMapping.oldId);
      
      // Delete old inspection entry keyed by temp ID
      await deleteOfflineInspection(inspectionIdMapping.oldId);
      
      // Clean up child record stores that were keyed under the old temp inspection_id
      const childStores = ['systems', 'ziplines', 'equipment', 'standards', 'summary'] as const;
      for (const store of childStores) {
        await clearRelatedDataOffline(store, inspectionIdMapping.oldId);
      }
      
      // Save child records under the new UUID
      await Promise.all([
        systems.length > 0 ? saveRelatedDataOffline('systems', inspectionIdMapping.newId, systems) : Promise.resolve(),
        ziplines.length > 0 ? saveRelatedDataOffline('ziplines', inspectionIdMapping.newId, ziplines) : Promise.resolve(),
        equipment.length > 0 ? saveRelatedDataOffline('equipment', inspectionIdMapping.newId, equipment) : Promise.resolve(),
        standards.length > 0 ? saveRelatedDataOffline('standards', inspectionIdMapping.newId, standards) : Promise.resolve(),
        summary ? saveRelatedDataOffline('summary', inspectionIdMapping.newId, [summary]) : Promise.resolve(),
      ]);
      
      // Relink photos from temp ID to new UUID so syncPhotos() can upload them
      await relinkPhotosToNewInspectionId(inspectionIdMapping.oldId, inspectionIdMapping.newId);
    }
    
    // Clean up any queued operations entries for this inspection
    try {
      const queuedOps = await getQueuedOperations();
      const matchingOps = queuedOps.filter(op => {
        const opInspectionId = op.inspectionId || op.data?.id;
        return opInspectionId === inspectionId || (inspectionIdMapping && opInspectionId === inspectionIdMapping.oldId);
      });
      for (const op of matchingOps) {
        await removeQueuedOperation(op.id!);
      }
      if (matchingOps.length > 0 && import.meta.env.DEV) {
        syncLog.log(`[Atomic Sync] Cleaned up ${matchingOps.length} orphaned operations entries for ${inspectionId}`);
      }
    } catch (cleanupErr) {
      console.warn('[Atomic Sync] Non-blocking: failed to clean operations queue:', cleanupErr);
    }
    
    if (import.meta.env.DEV) {
      syncLog.log('[Atomic Sync] Successfully synced inspection:', inspectionId);
    }

    // H3: parent + children committed. If deferred reconcile was blocked or
    // failed, surface as partial-success so caller knows to retry next cycle.
    return inspectionReconcileBlocked
      ? { success: true, partial: true, reason: 'reconcile_pending', message: 'Some local deletions could not be confirmed; will retry on next sync.' }
      : { success: true };
    
  } catch (error: any) {
    console.error('[Atomic Sync] Failed to sync inspection:', inspectionId, error);
    throw error;
  }
}

/**
 * Sync all unsynced inspections atomically
 */
export async function syncAllInspectionsAtomic(preValidatedUser?: CachedUser, signal?: AbortSignal) {
  const capabilities = getMobileCapabilities();
  const ITEM_SYNC_TIMEOUT = 25000; // 25 seconds per item max (increased for mobile networks)
  
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      syncLog.log('[Atomic Sync] Offline - skipping sync');
    }
    return;
  }

  // C5: Refuse to start a batch when the active session token is the offline
  // placeholder or otherwise invalid. Prevents transmitting the placeholder
  // token over the wire and dead-lettering healthy records on 401s.
  if (!(await assertRealSessionForSync('inspections'))) {
    return { total: 0, success: 0, failed: 0, errors: [] };
  }

  // Use pre-validated user if provided (avoids redundant LockManager calls)
  let user: CachedUser | null = preValidatedUser || null;
  if (!user) {
    // CRITICAL: Validate session before sync to ensure valid JWT for RLS
    try {
      user = await Promise.race([
        ensureValidSession(),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 8000))
      ]);
    } catch (e) {
      console.warn('[Atomic Sync] Session validation timed out, skipping sync');
      return { total: 0, success: 0, failed: 0, errors: [] };
    }
  }
  
  if (!user) {
    console.warn('[Atomic Sync] No valid session, skipping sync');
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  // Only get unsynced inspections for the current user (with extended timeout for mobile)
  // Note: getUnsyncedInspections has its own internal timeout via withIndexedDBReadBoundary;
  // the outer 15s timeout here is a safety net for very slow mobile networks.
  // S11: getUnsyncedInspections now returns IdbReadFailure on failure (silent [] fallback removed).
  let unsynced: any[];
  let fetchFailureReason: string | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('IndexedDB timeout')), 15000)
    );
    
    const result = await Promise.race([
      getUnsyncedInspections(user.id),
      timeoutPromise
    ]);
    const { isIdbReadFailure } = await import('./offline-storage');
    if (isIdbReadFailure(result)) {
      fetchFailureReason = result.error;
      unsynced = [];
    } else {
      unsynced = result;
    }
  } catch (e: any) {
    if (e.message === 'IndexedDB timeout') {
      console.warn('[Atomic Sync] IndexedDB timeout getting unsynced inspections - will retry next cycle');
      fetchFailureReason = 'idb_outer_timeout';
    } else {
      console.warn('[Atomic Sync] Failed to get unsynced inspections:', e);
      fetchFailureReason = e?.message || 'unknown';
    }
    unsynced = [];
  }
  
  // Don't report success if we failed to fetch data (total: -1 signals fetch failure)
  if (fetchFailureReason) {
    return { total: -1, success: 0, failed: 0, errors: [{ id: 'idb_read_failure', error: fetchFailureReason }] };
  }
  
  // Early return for empty batch (consistent with trainings/assessments)
  if (unsynced.length === 0) {
    if (import.meta.env.DEV) {
      syncLog.log('[Atomic Sync] No inspections to sync');
    }
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  // S7: Adaptive batch — grows on success, resets on failure
  const adaptiveSize = getCurrentBatchSize();
  const totalUnsynced = unsynced.length;
  const batch = unsynced.slice(0, adaptiveSize);
  const remaining = totalUnsynced - batch.length;

  // Log temp-ID items for sync debugging (always, not just DEV)
  const tempIdItems = batch.filter(i => i.id.startsWith('temp-'));
  if (tempIdItems.length > 0) {
    syncLog.log('[Atomic Sync] Batch includes temp-ID inspections:', 
      tempIdItems.map(i => ({ id: i.id.substring(0, 20), org: i.organization }))
    );
  }
  
  if (import.meta.env.DEV) {
    syncLog.log('[Atomic Sync] Starting sync for unsynced inspections', {
      total: totalUnsynced,
      batchSize: batch.length,
      remaining,
      platform: capabilities.isIOS ? 'iOS' : capabilities.isAndroid ? 'Android' : 'Desktop',
      browser: capabilities.browser,
      isPWA: capabilities.isPWA,
    });
  }
  
  // Emit initial progress
  syncProgressEmitter.emit({
    total: batch.length,
    current: 0,
    currentItem: `Starting sync... (${totalUnsynced} total pending)`,
    phase: 'inspections',
    errors: [],
  });
  
  let successCount = 0;
  let failCount = 0;
  const errors: Array<{ id: string; error: string }> = [];
  
  // Mobile devices get retry logic
  const maxRetries = capabilities.isMobile ? 2 : 1; // Reduced retries for faster recovery
  // S2: Bounded concurrency — different inspectionIds never share child rows, and
  // executeTransaction is per-record. 3 on mobile / 5 on desktop is well within Supabase
  // connection-pool headroom and dramatically reduces wall-clock for queued drains.
  const itemConcurrency = capabilities.isMobile ? 3 : 5;
  let progressCounter = 0;

  await runWithConcurrency(batch, itemConcurrency, async (inspection, i) => {
    if (signal?.aborted) return;
    let retryCount = 0;
    let synced = false;

    while (retryCount < maxRetries && !synced && !signal?.aborted) {
      // Emit progress for current item
      progressCounter++;
      syncProgressEmitter.emit({
        total: batch.length,
        current: progressCounter,
        currentItem: `${formatProgressLabel([inspection.organization, inspection.location], 'Untitled inspection')}${retryCount > 0 ? ` (retry ${retryCount})` : ''}${remaining > 0 ? ` (${remaining} more queued)` : ''}`,
        phase: 'inspections',
        errors,
      });

      try {
        // Per-item timeout to prevent single item from blocking entire sync
        // Pass pre-validated user to skip redundant session validation per item
        const itemResult = await Promise.race([
          syncInspectionAtomic(inspection.id, user as CachedUser, signal),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Item sync timeout')), ITEM_SYNC_TIMEOUT))
        ]);
        // Only count as success if item was actually synced (not skipped)
        if (itemResult && typeof itemResult === 'object' && (itemResult as any).skipped) {
          // Skipped items don't count as success or failure
          if (import.meta.env.DEV) {
            syncLog.log(`[Atomic Sync] Skipped ${i + 1}/${unsynced.length}:`, inspection.id, (itemResult as any).reason);
          }
          synced = true; // Don't retry skipped items
        } else {
          successCount++;
          synced = true;
        }

        if (import.meta.env.DEV) {
          syncLog.log(`[Atomic Sync] Synced ${i + 1}/${batch.length} (${remaining} remaining):`, inspection.id);
        }
      } catch (error: any) {
        retryCount++;

        if (retryCount < maxRetries) {
          // Reduced backoff for faster iteration
          const delay = Math.min(500 * retryCount, 2000);
          if (import.meta.env.DEV) {
            syncLog.log(`[Atomic Sync] Retry ${retryCount}/${maxRetries} for ${inspection.id} after ${delay}ms`);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          failCount++;
          errors.push({ id: inspection.id, error: error.message });
          console.error('[Atomic Sync] Failed to sync inspection after retries:', inspection.id, error);
        }
      }
    }
  });
  
  // Emit completion
  syncProgressEmitter.emit({
    total: batch.length,
    current: batch.length,
    currentItem: remaining > 0 ? `Batch complete (${remaining} more queued)` : 'Sync complete',
    phase: 'complete',
    errors,
  });
  
  // Log results (always, not just DEV - critical for mobile production diagnostics)
  syncLog.log('[Atomic Sync] Inspection sync results:', {
    batch: batch.length,
    totalPending: totalUnsynced,
    remaining,
    success: successCount,
    failed: failCount,
  });
  if (failCount > 0) {
    console.error('[Atomic Sync] Errors:', errors);
  }
  
  return {
    total: totalUnsynced,
    success: successCount,
    failed: failCount,
    remaining,
    errors,
  };
}

/**
 * Helper function to validate UUID format
 */
function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Helper function to transform temp- IDs and invalid IDs to valid UUIDs
 * This handles:
 * - temp- prefixed IDs from UI
 * - Composite IDs that were incorrectly generated (e.g., "uuid-type-timestamp-random")
 * - Missing IDs
 */
function transformTempIds<T extends { id?: string }>(items: T[]): T[] {
  return items.map(item => {
    // Transform if: no id, starts with temp-, or not a valid UUID format
    const needsTransform = !item.id || 
      item.id.startsWith('temp-') || 
      !isValidUUID(item.id);
    
    return {
      ...item,
      id: needsTransform ? crypto.randomUUID() : item.id
    };
  });
}

/**
 * C8: Idempotently rewrite training child rows in IndexedDB from oldId → newId.
 * Reads each child store at oldId; if non-empty, mutates the foreign-key
 * (`training_id`) on each row to newId, saves the rewritten array under newId,
 * and clears the oldId entry. Safe to call multiple times — if oldId has no
 * children (because a prior call already migrated them), it's a no-op.
 *
 * MUST be called before any read at the canonical id post-swap, so that
 * `fetchId = trainingId` returns the user's actual local children on every
 * sync (first or Nth) instead of silently shipping an empty payload.
 */
async function rewriteTrainingChildrenIdb(oldId: string, newId: string): Promise<void> {
  if (oldId === newId) return;
  const childStores = ['delivery_approaches', 'operating_systems', 'immediate_attention', 'verifiable_items', 'systems_in_place', 'summary'] as const;
  for (const store of childStores) {
    try {
      const items = await getTrainingDataOffline(store, oldId);
      if (!items || items.length === 0) continue;
      const rewritten = items.map((item: any) => ({ ...item, training_id: newId }));
      await saveTrainingDataOffline(store, newId, rewritten);
      await clearTrainingDataOffline(store, oldId);
    } catch (e) {
      console.warn(`[C8] rewriteTrainingChildrenIdb failed for store ${store}`, e);
    }
  }
}

/**
 * C8: Idempotently rewrite daily assessment child rows in IndexedDB
 * from oldId → newId. See rewriteTrainingChildrenIdb for rationale.
 */
async function rewriteAssessmentChildrenIdb(oldId: string, newId: string): Promise<void> {
  if (oldId === newId) return;
  const childStores = ['beginning_of_day', 'end_of_day', 'operating_systems', 'equipment_checks', 'structure_checks', 'environment_checks'] as const;
  for (const store of childStores) {
    try {
      const items = await getAssessmentDataOffline(store, oldId);
      if (!items || items.length === 0) continue;
      const rewritten = items.map((item: any) => ({ ...item, assessment_id: newId }));
      await saveAssessmentDataOffline(store, newId, rewritten);
      await clearAssessmentDataOffline(store, oldId);
    } catch (e) {
      console.warn(`[C8] rewriteAssessmentChildrenIdb failed for store ${store}`, e);
    }
  }
}

/**
 * Sync training with all related data atomically
 */
export async function syncTrainingAtomic(trainingId: string, preValidatedUser?: CachedUser, signal?: AbortSignal) {
  if (signal?.aborted) return { success: false, skipped: true, reason: 'aborted' as const };
  if (!navigator.onLine) {
    throw new Error("Cannot sync while offline");
  }
  
  // Track temp-to-UUID mapping for post-sync IndexedDB cleanup
  let trainingIdMapping: { oldId: string; newId: string } | null = null;
  
  try {
    // 1. Gather all data for this training
    const training = await getOfflineTraining(trainingId);
    if (!training) {
      throw new Error("Training not found in local storage");
    }
    // C1: capture T0 updated_at for concurrent-edit detection at post-sync save.
    const trainingT0UpdatedAtMs = training.updated_at ? Date.parse(training.updated_at) : NaN;
    
    // Detect and replace temp training IDs with real UUIDs before validation
    if (training.id.startsWith('temp-')) {
      // S5: DEDUP via stable client_idempotency_key (server-enforced via partial unique index).
      const idempKey = (training as any).client_idempotency_key
        ?? training.id.replace(/^temp-/, '');

      const { data: dupRows } = await supabase
        .from('trainings')
        .select('id')
        .eq('inspector_id', training.inspector_id)
        .eq('client_idempotency_key', idempKey)
        .limit(2);

      if (dupRows && dupRows.length > 0) {
        if (dupRows.length > 1) {
          console.warn('[Atomic Sync] Multiple server rows share idempotency key — adopting first, manual cleanup needed', {
            idempKey, ids: dupRows.map(r => r.id),
          });
        }
        const serverId = dupRows[0].id;
        syncLog.log('[Atomic Sync] Found existing server record for temp training - adopting ID:', {
          tempId: training.id,
          serverId,
        });
        trainingIdMapping = { oldId: training.id, newId: serverId };
        training.id = serverId;
        trainingId = serverId;
      } else {
        const newId = crypto.randomUUID();
        trainingIdMapping = { oldId: training.id, newId };
        syncLog.log('[Atomic Sync] Replacing temp training ID with real UUID:', {
          oldId: training.id,
          newId,
        });
        training.id = newId;
        trainingId = newId;
      }

      (training as any).client_idempotency_key = idempKey;
    }
    
    // Use pre-validated user from batch caller, or validate session if called individually
    const user = preValidatedUser || await ensureValidSession();
    if (!user) {
      console.error('[Atomic Sync] No valid session - sync aborted for training:', trainingId);
      throw new Error('No valid session for sync');
    }
    
    // Auto-fix ownership for locally-created records, skip only for server-origin records
    if (training.inspector_id !== user.id) {
      if (!training.synced_at) {
        syncLog.log('[Atomic Sync] Auto-fixing inspector_id for local training:', {
          trainingId,
          oldInspectorId: training.inspector_id?.substring(0, 8),
          newInspectorId: user.id.substring(0, 8),
        });
        training.inspector_id = user.id;
        await saveTrainingOffline(training);
      } else {
        console.warn('[Atomic Sync] Skipping training - belongs to different user', {
          training_id: trainingId,
        });
        return { success: false, skipped: true, reason: 'ownership_mismatch' };
      }
    }
    
    // C8: If we swapped the training ID, rewrite IDB children oldId → newId
    // BEFORE reading them. The post-upsert cleanup block also performs this
    // rewrite, but on the *first* sync children still live under the temp id
    // at this point, and on every *subsequent* sync they live under the new
    // id. Reading at a single canonical id (trainingId, post-swap) requires
    // the rewrite to happen here, idempotently. Without this, subsequent
    // syncs read [] from oldId and ship empty children payloads, silently
    // breaking edits and tripping reconcile guards.
    if (trainingIdMapping) {
      await rewriteTrainingChildrenIdb(trainingIdMapping.oldId, trainingIdMapping.newId);
    }

    // C8: Always read children at the canonical (post-migration) id.
    const fetchId = trainingId;

    // S32: Serialized to avoid Safari IDB lock contention (see syncInspectionAtomic).
    const daRead = await getTrainingDataOfflineWithStatus('delivery_approaches', fetchId);
    const osRead = await getTrainingDataOfflineWithStatus('operating_systems', fetchId);
    const iaRead = await getTrainingDataOfflineWithStatus('immediate_attention', fetchId);
    const viRead = await getTrainingDataOfflineWithStatus('verifiable_items', fetchId);
    const sipRead = await getTrainingDataOfflineWithStatus('systems_in_place', fetchId);
    const summaryReadT = await getTrainingDataOfflineWithStatus('summary', fetchId);
    const rawDeliveryApproaches = daRead.items;
    const rawOperatingSystems = osRead.items;
    const rawImmediateAttention = iaRead.items;
    const rawVerifiableItems = viRead.items;
    const rawSystemsInPlace = sipRead.items;
    const summaryArray = summaryReadT.items;
    const trainingIdbReadFlags = {
      delivery_approaches: daRead.readSucceeded,
      operating_systems: osRead.readSucceeded,
      immediate_attention: iaRead.readSucceeded,
      verifiable_items: viRead.readSucceeded,
      systems_in_place: sipRead.readSucceeded,
      summary: summaryReadT.readSucceeded,
    };

    let rawSummary = summaryArray[0] || null;

    // C8: Invariant — by this point fetchId must equal the canonical trainingId.
    // If a future refactor reintroduces divergence, fail loudly in DEV.
    if (import.meta.env.DEV && fetchId !== trainingId) {
      console.error('[C8] fetchId/trainingId divergence detected', { fetchId, trainingId });
    }
    
    // Transform temp- IDs to valid UUIDs before validation
    const delivery_approaches = transformTempIds(rawDeliveryApproaches);
    const operating_systems = transformTempIds(rawOperatingSystems);
    const immediate_attention = transformTempIds(rawImmediateAttention);
    const verifiable_items = transformTempIds(rawVerifiableItems);
    const systems_in_place = transformTempIds(rawSystemsInPlace);
    const summary = rawSummary?.id?.startsWith('temp-') 
      ? { ...rawSummary, id: crypto.randomUUID() } 
      : rawSummary;
    
    // 2. Validate the complete package
    const validation = validateTrainingPackage({
      training,
      delivery_approaches,
      operating_systems,
      immediate_attention,
      verifiable_items,
      systems_in_place,
      summary,
    });
    
    if (!validation.success) {
      console.error('[Atomic Sync] Training validation failed:', validation.errors);
      throw new Error(`Validation failed: ${JSON.stringify(validation.errors)}`);
    }
    
    if (import.meta.env.DEV) {
      syncLog.log('[Atomic Sync] Training data gathered:', {
        trainingId,
        organization: training.organization,
        relatedData: {
          delivery_approaches: delivery_approaches.length,
          operating_systems: operating_systems.length,
          immediate_attention: immediate_attention.length,
          verifiable_items: verifiable_items.length,
          systems_in_place: systems_in_place.length,
          hasSummary: !!summary,
        }
      });
    }
    
    // RC-5: Skip remote status check for new records (never synced = never on server)
    const isNewTraining = !training.synced_at;
    const recordStatus = isNewTraining ? null : await checkRemoteRecordStatus('trainings', trainingId);
    
    // C9: Remote training was soft-deleted. Quarantine if unsynced edits exist.
    if (recordStatus?.record_exists && recordStatus?.is_deleted) {
      const remoteDeletedAt = recordStatus.deleted_at ?? new Date().toISOString();
      const result = await handleRemoteDeleted(
        'trainings',
        trainingId,
        training,
        remoteDeletedAt,
        async () => {
          await deleteOfflineTraining(trainingId);
        },
      );
      return {
        success: false,
        skipped: true,
        reason: 'remote_deleted' as const,
        quarantined: result.quarantined,
        message: result.quarantined
          ? 'This training was deleted by an administrator while you had unsynced changes. Resolve in the conflict dialog.'
          : 'This training was deleted by an administrator. Local copy has been cleaned up.',
      };
    }
    
    // S16: Field-level merge for trainings (matches inspections path).
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      const remoteUpdated = new Date(recordStatus.updated_at!).getTime();
      const localSyncedAt = training.synced_at ? new Date(training.synced_at).getTime() : 0;
      // H4: merge whenever remote changed after our last successful sync.
      const remoteChangedSinceOurSync =
        localSyncedAt === 0 || remoteUpdated > localSyncedAt + SYNC_DRIFT_TOLERANCE_MS;

      if (remoteChangedSinceOurSync) {
        const { data: remoteRow } = await supabase
          .from('trainings')
          .select('*')
          .eq('id', trainingId)
          .maybeSingle();
        if (remoteRow) {
          const merged = mergeRecordFields<any>(
            training as any,
            remoteRow as any,
            TRACKED_FIELDS.training,
          );
          Object.assign(training, merged);
          if (import.meta.env.DEV) {
            syncLog.log('[Atomic Sync] S16 field-merged training:', trainingId);
          }
        }
      }
    }
    
    // PRE-SYNC VERSION SNAPSHOT — capture immutable state before sync
    appendVersion('training', trainingId, training, {
      delivery_approaches, operating_systems, immediate_attention,
      verifiable_items, systems_in_place, summary: summary ? [summary] : [],
    }, 'pre_sync').catch(() => {});

    // FIELD-COUNT REGRESSION GUARD — block sync if local data regressed significantly
    const currentFieldCount = calculateFieldCount(training, {
      delivery_approaches, operating_systems, immediate_attention,
      verifiable_items, systems_in_place, summary: summary ? [summary] : [],
    });
    const previousFieldCount = await getLatestFieldCount(trainingId);
    if (previousFieldCount !== null && previousFieldCount > 0) {
      const dropPercent = ((previousFieldCount - currentFieldCount) / previousFieldCount) * 100;
      if (dropPercent > 50) {
        const skipCount = await incrementRegressionSkipCount(trainingId);
        if (skipCount <= MAX_REGRESSION_SKIPS) {
          console.error('[SAFETY] Blocked training sync: field count regression >50%', {
            trainingId: trainingId.substring(0, 8),
            previousFieldCount,
            currentFieldCount,
            dropPercent: dropPercent.toFixed(1),
            skipCount,
            maxSkips: MAX_REGRESSION_SKIPS,
          });
          notifyRegressionBlock(
            'training',
            trainingId,
            (training as any)?.organization || (training as any)?.location || '',
            skipCount,
          );
          return { success: false, skipped: true, reason: 'field_count_regression' };
        }
        console.warn('[SAFETY] Allowing training sync after max regression skips reached', {
          trainingId: trainingId.substring(0, 8),
          skipCount,
        });
        await resetRegressionSkipCount(trainingId);
        notifyRegressionRelease();
      } else {
        await resetRegressionSkipCount(trainingId);
        notifyRegressionRelease();
      }
    }

    // M15: Hard guard — fail loud if any temp- ID slipped past the transforms above.
    assertNoTempIds(training, 'trainings.upsert');
    assertNoTempIdsInArray(delivery_approaches, 'training_delivery_approaches.upsert');
    assertNoTempIdsInArray(operating_systems, 'training_operating_systems.upsert');
    assertNoTempIdsInArray(immediate_attention, 'training_immediate_attention.upsert');
    assertNoTempIdsInArray(verifiable_items, 'training_verifiable_items.upsert');
    assertNoTempIdsInArray(systems_in_place, 'training_systems_in_place.upsert');
    if (summary) assertNoTempIds(summary, 'training_summary.upsert');

    // 4. Build transaction steps
    const steps: TransactionStep[] = [];
    
    // Exclude joined objects - only column fields exist in DB
    const { inspector, trainer, ...trainingWithoutJoin } = training as any;
    
    // For rollback, capture both synced_at and updated_at for proper state restoration
    const rollbackData = recordStatus?.record_exists 
      ? { synced_at: recordStatus.synced_at, updated_at: recordStatus.updated_at } 
      : null;
    
    // Step 1: Upsert training WITHOUT setting synced_at (defer to final step)
    // This ensures synced_at is only set after ALL related data is committed
    steps.push({
      table: 'trainings',
      operation: 'upsert',
      data: {
        ...trainingWithoutJoin,
        // DO NOT set synced_at here - it will be set in the final step
      },
      rollbackData,
    });
    
    let existingApproaches: any[] = [];
    let existingSystems: any[] = [];
    let existingAttention: any[] = [];
    let existingVerifiable: any[] = [];
    let existingSystemsInPlace: any[] = [];
    let existingSummary: any[] = [];

    // S25: skip 6x rollback prefetch when server row is at our last-known baseline
    const serverUnchangedSinceBaseline =
      !!training.synced_at &&
      !!recordStatus?.updated_at &&
      recordStatus.updated_at === training.synced_at;

    if (recordStatus?.record_exists && !recordStatus?.is_deleted && !serverUnchangedSinceBaseline) {
      [
        existingApproaches,
        existingSystems,
        existingAttention,
        existingVerifiable,
        existingSystemsInPlace,
        existingSummary
      ] = await Promise.all([
        fetchRollbackData('training_delivery_approaches', { training_id: trainingId }),
        fetchRollbackData('training_operating_systems', { training_id: trainingId }),
        fetchRollbackData('training_immediate_attention', { training_id: trainingId }),
        fetchRollbackData('training_verifiable_items', { training_id: trainingId }),
        fetchRollbackData('training_systems_in_place', { training_id: trainingId }),
        fetchRollbackData('training_summary', { training_id: trainingId }),
      ]);
      
      const serverHasChildData = existingApproaches.length > 0 || existingSystems.length > 0 || 
        existingAttention.length > 0 || existingVerifiable.length > 0 || 
        existingSystemsInPlace.length > 0 || existingSummary.length > 0;
      const localIsCompletelyEmpty = delivery_approaches.length === 0 && operating_systems.length === 0 && 
        immediate_attention.length === 0 && verifiable_items.length === 0 && 
        systems_in_place.length === 0 && !summary;
      
      if (serverHasChildData && localIsCompletelyEmpty && !wasClearedAfterLastSync(training)) {
        const serverCounts = {
          approaches: existingApproaches.length,
          systems: existingSystems.length,
          attention: existingAttention.length,
          verifiable: existingVerifiable.length,
          systemsInPlace: existingSystemsInPlace.length,
          summary: existingSummary.length,
        };
        console.warn('[SAFETY] empty_local_guard: training server has child data but local is empty', {
          trainingId,
          serverCounts,
        });

        // C2: Surface conflict instead of silently restoring server data.
        recordEmptyLocalConflictAndNotify(
          'training',
          trainingId,
          serverCounts,
          (training as any).organization || undefined,
        );

        return { success: false, skipped: true, reason: 'empty_local_guard' };
      }
    }
    
    // SUSPICIOUS EMPTY GUARD: If record has been edited but ALL child data is empty,
    // this likely means IndexedDB reads failed silently. Skip sync to prevent marking as complete.
    {
      const localIsCompletelyEmpty = delivery_approaches.length === 0 && operating_systems.length === 0 && 
        immediate_attention.length === 0 && verifiable_items.length === 0 && 
        systems_in_place.length === 0 && !summary;
      const createdAt = new Date(training.created_at || training.updated_at).getTime();
      const updatedAt = new Date(training.updated_at).getTime();
      const ageMinutes = (Date.now() - createdAt) / 60000;
      const wasEdited = (updatedAt - createdAt) > 60000;

      if (localIsCompletelyEmpty && wasEdited && ageMinutes > 5) {
        // M4: If EVERY child IDB read failed, refuse to sync the empty payload.
        const allIdbReadsFailed =
          !trainingIdbReadFlags.delivery_approaches &&
          !trainingIdbReadFlags.operating_systems &&
          !trainingIdbReadFlags.immediate_attention &&
          !trainingIdbReadFlags.verifiable_items &&
          !trainingIdbReadFlags.systems_in_place &&
          !trainingIdbReadFlags.summary;
        if (allIdbReadsFailed) {
          console.warn('[SAFETY] suspicious_empty_guard: all IDB child reads failed, skipping training sync', {
            trainingId: trainingId.substring(0, 8),
            ageMinutes: Math.round(ageMinutes),
          });
          return { success: false, skipped: true, reason: 'suspicious_empty_idb_read_failure' };
        }
        if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
          // Guard 1 already ran and didn't block — server is also empty. Allow sync.
          syncLog.log('[SYNC] suspicious_empty_guard: both local and server are empty, allowing sync for genuinely blank training', {
            trainingId: trainingId.substring(0, 8),
          });
        } else {
          // Record doesn't exist on server yet — new blank form, allow sync
          syncLog.log('[SYNC] suspicious_empty_guard: new training with no server data, allowing sync', {
            trainingId: trainingId.substring(0, 8),
          });
        }
      }
    }

    // Step 2: UPSERT child data first; reconcile (DELETE) is DEFERRED until
    // after the transaction commits (H3).
    let trainingReconcileSpec: import('./deferred-reconcile').DeferredReconcileSpec[] | null = null;
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      const pf = (arr: any[]) => (serverUnchangedSinceBaseline ? undefined : arr);
      trainingReconcileSpec = [
        { childTable: 'training_delivery_approaches', parentIdColumn: 'training_id', localItems: delivery_approaches, prefetchedServerRows: pf(existingApproaches), expectedNonEmpty: trainingIdbReadFlags.delivery_approaches },
        { childTable: 'training_operating_systems', parentIdColumn: 'training_id', localItems: operating_systems, prefetchedServerRows: pf(existingSystems), expectedNonEmpty: trainingIdbReadFlags.operating_systems },
        { childTable: 'training_immediate_attention', parentIdColumn: 'training_id', localItems: immediate_attention, prefetchedServerRows: pf(existingAttention), expectedNonEmpty: trainingIdbReadFlags.immediate_attention },
        { childTable: 'training_verifiable_items', parentIdColumn: 'training_id', localItems: verifiable_items, prefetchedServerRows: pf(existingVerifiable), expectedNonEmpty: trainingIdbReadFlags.verifiable_items },
        { childTable: 'training_systems_in_place', parentIdColumn: 'training_id', localItems: systems_in_place, prefetchedServerRows: pf(existingSystemsInPlace), expectedNonEmpty: trainingIdbReadFlags.systems_in_place },
        { childTable: 'training_summary', parentIdColumn: 'training_id', localItems: summary ? [summary] : [], prefetchedServerRows: pf(existingSummary), expectedNonEmpty: trainingIdbReadFlags.summary },
      ];
    }

    if (delivery_approaches.length > 0) {
      steps.push({
        table: 'training_delivery_approaches',
        operation: 'upsert',
        data: delivery_approaches,
        rollbackData: existingApproaches,
      });
    }
    
    if (operating_systems.length > 0) {
      steps.push({
        table: 'training_operating_systems',
        operation: 'upsert',
        data: operating_systems,
        rollbackData: existingSystems,
      });
    }
    
    if (immediate_attention.length > 0) {
      steps.push({
        table: 'training_immediate_attention',
        operation: 'upsert',
        data: immediate_attention,
        rollbackData: existingAttention,
      });
    }
    
    if (verifiable_items.length > 0) {
      steps.push({
        table: 'training_verifiable_items',
        operation: 'upsert',
        data: verifiable_items,
        rollbackData: existingVerifiable,
      });
    }
    
    if (systems_in_place.length > 0) {
      steps.push({
        table: 'training_systems_in_place',
        operation: 'upsert',
        data: systems_in_place,
        rollbackData: existingSystemsInPlace,
      });
    }
    
    if (summary) {
      // Sanitize summary before sync
      const sanitizedSummary = {
        ...summary,
        submission_date: summary.submission_date === "" ? null : summary.submission_date
      };
      
      steps.push({
        table: 'training_summary',
        operation: 'upsert',
        data: [sanitizedSummary],
        rollbackData: existingSummary,
      });
    }
    
    // FINAL STEP: Set synced_at ONLY after all related data is successfully inserted
    // This is the atomic guarantee - synced_at only updates when everything commits
    steps.push({
      table: 'trainings',
      operation: 'update',
      data: { synced_at: new Date().toISOString(), last_sync_source: 'main_thread' },
      filter: { id: trainingId },
    });
    
    // 5. Execute transaction
    // S6: register self-write so the Realtime handler doesn't re-trigger sync from our own writes
    registerSelfWrite(trainingId);
    const result = await executeTransaction(steps, { signal });
    
    if (!result.success) {
      // H3: nothing to compensate — reconcile is now deferred until AFTER the
      // transaction commits, so a failed upsert leaves the server untouched.
      throw new Error(`Transaction failed after ${result.completedSteps}/${result.totalSteps} steps. Rollback: ${result.rollbackSuccess ? 'successful' : 'failed'}`);
    }

    // H3: parent + children are committed; run deferred reconcile now.
    let trainingReconcileBlocked = false;
    if (trainingReconcileSpec) {
      const { runDeferredReconcile } = await import('./deferred-reconcile');
      const outcome = await runDeferredReconcile(
        trainingReconcileSpec,
        trainingId,
        'training',
        user.id,
      );
      trainingReconcileBlocked = outcome.result?.blocked === true || !outcome.ran;
    }
    
    // S4: Skip post-transaction verify SELECT — `executeTransaction` row-count guard +
    // `align_synced_at` failure-on-missing-row already provide the same guarantee.
    
    // 6. Get cached inspector profile to attach to offline data
    const inspectorProfile = await getCachedProfile(user.id);
    
    // POST-SYNC ALIGNMENT: Call align_synced_at RPC to set synced_at = updated_at on server
    registerSelfWrite(trainingId); // S6: align_synced_at is a separate server write
    const { data: aligned, error: alignError } = await supabase.rpc('align_synced_at', {
      p_table_name: 'trainings',
      p_record_id: trainingId,
    });

    // S3: align_synced_at is ADVISORY. Transaction final step already wrote synced_at.
    // S14: on RPC failure, fetch server-authoritative timestamps instead of using client clock.
    let serverTimestamp: string;
    const alignedData = aligned as any;
    if (alignError || !alignedData || alignedData.error) {
      console.warn(
        '[Atomic Sync] align_synced_at non-fatal failure — fetching server timestamp',
        { table: 'trainings', id: trainingId, alignError: alignError?.message, aligned }
      );
      const { data: serverRow } = await supabase
        .from('trainings')
        .select('updated_at, synced_at')
        .eq('id', trainingId)
        .maybeSingle();
      serverTimestamp =
        (serverRow as any)?.synced_at ||
        (serverRow as any)?.updated_at ||
        (steps[steps.length - 1].data as any).synced_at;
    } else {
      serverTimestamp = alignedData.updated_at;
      syncLog.log(
        '%c[SYNC_TERMINAL] align_synced_at CONFIRMED %c%s',
        'color: #4ade80; font-family: monospace; font-weight: bold',
        'color: #86efac; font-family: monospace',
        `| table=trainings | id=${trainingId.substring(0,8)}... | ts=${serverTimestamp}`
      );
    }
    
    // C1: guard against clobbering an auto-save that landed during the round-trip.
    await safePostSyncSave(
      trainingId,
      training,
      trainingT0UpdatedAtMs,
      serverTimestamp,
      {
        user_cleared_at: null,
        inspector: inspectorProfile || { first_name: null, last_name: null, avatar_url: null },
      } as any,
      getOfflineTraining,
      saveTrainingOffline,
    );
    
    // 7. If we swapped a temp ID, clean up old IndexedDB entries
    if (trainingIdMapping) {
      syncLog.log('[Atomic Sync] Cleaning up old temp-ID entries from IndexedDB:', trainingIdMapping.oldId);
      
      // Delete old training entry keyed by temp ID
      await deleteOfflineTraining(trainingIdMapping.oldId);
      
      // Clean up child record stores that were keyed under the old temp training_id
      const childStores = ['delivery_approaches', 'operating_systems', 'immediate_attention', 'verifiable_items', 'systems_in_place', 'summary'] as const;
      for (const store of childStores) {
        await clearTrainingDataOffline(store, trainingIdMapping.oldId);
      }
      
      // Save child records under the new UUID
      await Promise.all([
        delivery_approaches.length > 0 ? saveTrainingDataOffline('delivery_approaches', trainingIdMapping.newId, delivery_approaches) : Promise.resolve(),
        operating_systems.length > 0 ? saveTrainingDataOffline('operating_systems', trainingIdMapping.newId, operating_systems) : Promise.resolve(),
        immediate_attention.length > 0 ? saveTrainingDataOffline('immediate_attention', trainingIdMapping.newId, immediate_attention) : Promise.resolve(),
        verifiable_items.length > 0 ? saveTrainingDataOffline('verifiable_items', trainingIdMapping.newId, verifiable_items) : Promise.resolve(),
        systems_in_place.length > 0 ? saveTrainingDataOffline('systems_in_place', trainingIdMapping.newId, systems_in_place) : Promise.resolve(),
        summary ? saveTrainingDataOffline('summary', trainingIdMapping.newId, [summary]) : Promise.resolve(),
      ]);
      
      // Relink photos from temp ID to new UUID so syncPhotos() can upload them
      await relinkPhotosToNewInspectionId(trainingIdMapping.oldId, trainingIdMapping.newId);
    }
    
    if (import.meta.env.DEV) {
      syncLog.log('[Atomic Sync] Successfully synced training with related data:', {
        trainingId,
        stepsCompleted: result.completedSteps,
        totalSteps: result.totalSteps,
      });
    }
    
    // Clean up any queued training_operations entries for this training
    // These are redundant now that the atomic sync has handled the data
    try {
      const queuedOps = await getQueuedTrainingOperations();
      const matchingOps = queuedOps.filter(op => {
        const opTrainingId = (op as any).trainingId || op.data?.id;
        return opTrainingId === trainingId || (trainingIdMapping && opTrainingId === trainingIdMapping.oldId);
      });
      for (const op of matchingOps) {
        await removeQueuedTrainingOperation(op.id!);
      }
      if (matchingOps.length > 0 && import.meta.env.DEV) {
        syncLog.log(`[Atomic Sync] Cleaned up ${matchingOps.length} orphaned training_operations entries for ${trainingId}`);
      }
    } catch (cleanupErr) {
      console.warn('[Atomic Sync] Non-blocking: failed to clean training_operations queue:', cleanupErr);
    }
    
    // H3: parent + children committed. Surface deferred-reconcile status.
    return trainingReconcileBlocked
      ? { success: true, partial: true, reason: 'reconcile_pending', message: 'Some local deletions could not be confirmed; will retry on next sync.' }
      : { success: true };
    
  } catch (error: any) {
    console.error('[Atomic Sync] Failed to sync training:', trainingId, error);
    throw error;
  }
}

/**
 * Sync all unsynced trainings atomically
 */
export async function syncAllTrainingsAtomic(preValidatedUser?: CachedUser, signal?: AbortSignal) {
  const capabilities = getMobileCapabilities();
  const ITEM_SYNC_TIMEOUT = 25000; // 25 seconds per item max (increased for mobile networks)
  
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      syncLog.log('[Atomic Sync] Offline - skipping training sync');
    }
    return { total: 0, success: 0, failed: 0, errors: [] };
  }

  // C5: Refuse to start a batch when the active session token is the offline
  // placeholder or otherwise invalid.
  if (!(await assertRealSessionForSync('trainings'))) {
    return { total: 0, success: 0, failed: 0, errors: [] };
  }

  // Use pre-validated user if provided (avoids redundant LockManager calls)
  let user: CachedUser | null = preValidatedUser || null;
  if (!user) {
    // CRITICAL: Validate session before sync to ensure valid JWT for RLS
    try {
      user = await Promise.race([
        ensureValidSession(),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 8000))
      ]);
    } catch (e) {
      console.warn('[Atomic Sync] Session validation timed out for trainings, skipping');
      return { total: 0, success: 0, failed: 0, errors: [] };
    }
  }
  
  if (!user) {
    console.warn('[Atomic Sync] No valid session for training sync');
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  // S11: getUnsyncedTrainings now returns IdbReadFailure on failure
  let unsynced: any[];
  let fetchFailureReason: string | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('IndexedDB timeout')), 15000)
    );
    
    const result = await Promise.race([
      getUnsyncedTrainings(user.id),
      timeoutPromise
    ]);
    const { isIdbReadFailure } = await import('./offline-storage');
    if (isIdbReadFailure(result)) {
      fetchFailureReason = result.error;
      unsynced = [];
    } else {
      unsynced = result;
    }
  } catch (e: any) {
    if (e.message === 'IndexedDB timeout') {
      console.warn('[Atomic Sync] IndexedDB timeout getting unsynced trainings - will retry next cycle');
      fetchFailureReason = 'idb_outer_timeout';
    } else {
      console.warn('[Atomic Sync] Failed to get unsynced trainings:', e);
      fetchFailureReason = e?.message || 'unknown';
    }
    unsynced = [];
  }
  
  // Don't report success if we failed to fetch data (total: -1 signals fetch failure)
  if (fetchFailureReason) {
    return { total: -1, success: 0, failed: 0, errors: [{ id: 'idb_read_failure', error: fetchFailureReason }] };
  }
  
  if (unsynced.length === 0) {
    if (import.meta.env.DEV) {
      syncLog.log('[Atomic Sync] No trainings to sync');
    }
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  // S7: Adaptive batch — grows on success, resets on failure
  const adaptiveSize = getCurrentBatchSize();
  const totalUnsynced = unsynced.length;
  const batch = unsynced.slice(0, adaptiveSize);
  const remaining = totalUnsynced - batch.length;

  if (import.meta.env.DEV) {
    syncLog.log('[Atomic Sync] Starting sync for unsynced trainings', {
      total: totalUnsynced,
      batchSize: batch.length,
      remaining,
      platform: capabilities.isIOS ? 'iOS' : capabilities.isAndroid ? 'Android' : 'Desktop',
    });
  }
  
  // Emit initial progress
  syncProgressEmitter.emit({
    total: batch.length,
    current: 0,
    currentItem: `Starting training sync... (${totalUnsynced} total pending)`,
    phase: 'trainings',
    errors: [],
  });
  
  let successCount = 0;
  let failCount = 0;
  const errors: Array<{ id: string; error: string }> = [];
  
  // Reduced retries for faster recovery
  const maxRetries = capabilities.isMobile ? 2 : 1;
  // S2: Bounded concurrency — different trainingIds never share child rows.
  const itemConcurrency = capabilities.isMobile ? 3 : 5;
  let progressCounter = 0;

  await runWithConcurrency(batch, itemConcurrency, async (training, i) => {
    if (signal?.aborted) return;
    let retryCount = 0;
    let synced = false;

    while (retryCount < maxRetries && !synced && !signal?.aborted) {
      // Emit progress for current item
      progressCounter++;
      syncProgressEmitter.emit({
        total: batch.length,
        current: progressCounter,
        currentItem: `${formatProgressLabel([training.organization, training.location], 'Untitled training')}${retryCount > 0 ? ` (retry ${retryCount})` : ''}${remaining > 0 ? ` (${remaining} more queued)` : ''}`,
        phase: 'trainings',
        errors,
      });

      try {
        // Per-item timeout - pass pre-validated user to skip redundant session validation
        const itemResult = await Promise.race([
          syncTrainingAtomic(training.id, user as CachedUser, signal),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Item sync timeout')), ITEM_SYNC_TIMEOUT))
        ]);
        if (itemResult && typeof itemResult === 'object' && (itemResult as any).skipped) {
          synced = true;
        } else {
          successCount++;
          synced = true;
        }

        if (import.meta.env.DEV) {
          syncLog.log(`[Atomic Sync] Synced training ${i + 1}/${batch.length} (${remaining} remaining):`, training.id);
        }
      } catch (error: any) {
        retryCount++;

        if (retryCount < maxRetries) {
          const delay = Math.min(500 * retryCount, 2000);
          if (import.meta.env.DEV) {
            syncLog.log(`[Atomic Sync] Retry ${retryCount}/${maxRetries} for training ${training.id} after ${delay}ms`);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          failCount++;
          errors.push({ id: training.id, error: error.message });
          console.error('[Atomic Sync] Failed to sync training after retries:', training.id, error);
        }
      }
    }
  });
  
  syncLog.log('[Atomic Sync] Training sync results:', {
    batch: batch.length,
    totalPending: totalUnsynced,
    remaining,
    success: successCount,
    failed: failCount,
  });
  
  return {
    total: totalUnsynced,
    success: successCount,
    failed: failCount,
    remaining,
    errors,
  };
}

/**
 * Sync daily assessment with all related data atomically
 */
export async function syncDailyAssessmentAtomic(assessmentId: string, preValidatedUser?: CachedUser, signal?: AbortSignal) {
  if (signal?.aborted) return { success: false, skipped: true, reason: 'aborted' as const };
  if (!navigator.onLine) {
    throw new Error("Cannot sync while offline");
  }
  
  // Track temp-to-UUID mapping for post-sync IndexedDB cleanup
  let assessmentIdMapping: { oldId: string; newId: string } | null = null;
  
  try {
    // 1. Gather all data for this assessment
    const assessment = await getOfflineDailyAssessment(assessmentId);
    if (!assessment) {
      throw new Error("Daily assessment not found in local storage");
    }
    // C1: capture T0 updated_at for concurrent-edit detection at post-sync save.
    const assessmentT0UpdatedAtMs = assessment.updated_at ? Date.parse(assessment.updated_at) : NaN;
    
    // Detect and replace temp assessment IDs with real UUIDs before validation
    if (assessment.id.startsWith('temp-')) {
      // S5: DEDUP via stable client_idempotency_key (server-enforced via partial unique index).
      const idempKey = (assessment as any).client_idempotency_key
        ?? assessment.id.replace(/^temp-/, '');

      const { data: dupRows } = await supabase
        .from('daily_assessments')
        .select('id')
        .eq('inspector_id', assessment.inspector_id)
        .eq('client_idempotency_key', idempKey)
        .limit(2);

      if (dupRows && dupRows.length > 0) {
        if (dupRows.length > 1) {
          console.warn('[Atomic Sync] Multiple server rows share idempotency key — adopting first, manual cleanup needed', {
            idempKey, ids: dupRows.map(r => r.id),
          });
        }
        const serverId = dupRows[0].id;
        syncLog.log('[Atomic Sync] Found existing server record for temp assessment - adopting ID:', {
          tempId: assessment.id,
          serverId,
        });
        assessmentIdMapping = { oldId: assessment.id, newId: serverId };
        assessment.id = serverId;
        assessmentId = serverId;
      } else {
        const newId = crypto.randomUUID();
        assessmentIdMapping = { oldId: assessment.id, newId };
        syncLog.log('[Atomic Sync] Replacing temp assessment ID with real UUID:', {
          oldId: assessment.id,
          newId,
        });
        assessment.id = newId;
        assessmentId = newId;
      }

      (assessment as any).client_idempotency_key = idempKey;
    }
    
    // Use pre-validated user from batch caller, or validate session if called individually
    const user = preValidatedUser || await ensureValidSession();
    if (!user) {
      console.error('[Atomic Sync] No valid session - sync aborted for assessment:', assessmentId);
      throw new Error('No valid session for sync');
    }
    
    // Auto-fix ownership for locally-created records, skip only for server-origin records
    if (assessment.inspector_id !== user.id) {
      if (!assessment.synced_at) {
        syncLog.log('[Atomic Sync] Auto-fixing inspector_id for local assessment:', {
          assessmentId,
          oldInspectorId: assessment.inspector_id?.substring(0, 8),
          newInspectorId: user.id.substring(0, 8),
        });
        assessment.inspector_id = user.id;
        await saveDailyAssessmentOffline(assessment);
      } else {
        console.warn('[Atomic Sync] Skipping assessment - belongs to different user', {
          assessment_id: assessmentId,
        });
        return { success: false, skipped: true, reason: 'ownership_mismatch' };
      }
    }
    
    // C8: If we swapped the assessment ID, rewrite IDB children oldId → newId
    // BEFORE reading them. See syncTrainingAtomic for full rationale.
    if (assessmentIdMapping) {
      await rewriteAssessmentChildrenIdb(assessmentIdMapping.oldId, assessmentIdMapping.newId);
    }

    // C8: Always read children at the canonical (post-migration) id.
    const fetchId = assessmentId;

    // S32: Serialized to avoid Safari IDB lock contention (see syncInspectionAtomic).
    const bodRead = await getAssessmentDataOfflineWithStatus('beginning_of_day', fetchId);
    const eodRead = await getAssessmentDataOfflineWithStatus('end_of_day', fetchId);
    const opSysRead = await getAssessmentDataOfflineWithStatus('operating_systems', fetchId);
    const eqRead = await getAssessmentDataOfflineWithStatus('equipment_checks', fetchId);
    const stRead = await getAssessmentDataOfflineWithStatus('structure_checks', fetchId);
    const envRead = await getAssessmentDataOfflineWithStatus('environment_checks', fetchId);
    const rawBeginningOfDay = bodRead.items;
    const rawEndOfDay = eodRead.items;
    const rawOperatingSystems = opSysRead.items;
    const rawEquipmentChecks = eqRead.items;
    const rawStructureChecks = stRead.items;
    const rawEnvironmentChecks = envRead.items;
    const assessmentIdbReadFlags = {
      beginning_of_day: bodRead.readSucceeded,
      end_of_day: eodRead.readSucceeded,
      operating_systems: opSysRead.readSucceeded,
      equipment_checks: eqRead.readSucceeded,
      structure_checks: stRead.readSucceeded,
      environment_checks: envRead.readSucceeded,
    };

    // C8: Invariant — by this point fetchId must equal the canonical assessmentId.
    if (import.meta.env.DEV && fetchId !== assessmentId) {
      console.error('[C8] fetchId/assessmentId divergence detected', { fetchId, assessmentId });
    }
    
    // Transform temp- IDs to valid UUIDs before validation
    const beginning_of_day = transformTempIds(rawBeginningOfDay);
    const end_of_day = transformTempIds(rawEndOfDay);
    const operating_systems = transformTempIds(rawOperatingSystems);
    const equipment_checks = transformTempIds(rawEquipmentChecks);
    const structure_checks = transformTempIds(rawStructureChecks);
    const environment_checks = transformTempIds(rawEnvironmentChecks);
    
    // 2. Validate the complete package
    const validation = validateDailyAssessmentPackage({
      assessment,
      beginning_of_day,
      end_of_day,
      operating_systems,
      equipment_checks,
      structure_checks,
      environment_checks,
    });
    
    if (!validation.success) {
      console.error('[Atomic Sync] Daily assessment validation failed:', validation.errors);
      throw new Error(`Validation failed: ${JSON.stringify(validation.errors)}`);
    }
    
    if (import.meta.env.DEV) {
      syncLog.log('[Atomic Sync] Daily assessment data gathered:', {
        assessmentId,
        organization: assessment.organization,
        relatedData: {
          beginning_of_day: beginning_of_day.length,
          end_of_day: end_of_day.length,
          operating_systems: operating_systems.length,
          equipment_checks: equipment_checks.length,
          structure_checks: structure_checks.length,
          environment_checks: environment_checks.length,
        }
      });
    }
    
    // RC-5: Skip remote status check for new records (never synced = never on server)
    const isNewAssessment = !assessment.synced_at;
    const recordStatus = isNewAssessment ? null : await checkRemoteRecordStatus('daily_assessments', assessmentId);
    
    // C9: Remote assessment was soft-deleted. Quarantine if unsynced edits exist.
    if (recordStatus?.record_exists && recordStatus?.is_deleted) {
      const remoteDeletedAt = recordStatus.deleted_at ?? new Date().toISOString();
      const result = await handleRemoteDeleted(
        'daily_assessments',
        assessmentId,
        assessment,
        remoteDeletedAt,
        async () => {
          await deleteOfflineDailyAssessment(assessmentId);
        },
      );
      return {
        success: false,
        skipped: true,
        reason: 'remote_deleted' as const,
        quarantined: result.quarantined,
        message: result.quarantined
          ? 'This assessment was deleted by an administrator while you had unsynced changes. Resolve in the conflict dialog.'
          : 'This assessment was deleted by an administrator. Local copy has been cleaned up.',
      };
    }
    
    // S16: Field-level merge for daily assessments (matches inspections path).
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      const remoteUpdated = new Date(recordStatus.updated_at!).getTime();
      const localSyncedAt = assessment.synced_at ? new Date(assessment.synced_at).getTime() : 0;
      // H4: merge whenever remote changed after our last successful sync.
      const remoteChangedSinceOurSync =
        localSyncedAt === 0 || remoteUpdated > localSyncedAt + SYNC_DRIFT_TOLERANCE_MS;

      if (remoteChangedSinceOurSync) {
        const { data: remoteRow } = await supabase
          .from('daily_assessments')
          .select('*')
          .eq('id', assessmentId)
          .maybeSingle();
        if (remoteRow) {
          const merged = mergeRecordFields<any>(
            assessment as any,
            remoteRow as any,
            TRACKED_FIELDS.daily_assessment,
          );
          Object.assign(assessment, merged);
          if (import.meta.env.DEV) {
            syncLog.log('[Atomic Sync] S16 field-merged assessment:', assessmentId);
          }
        }
      }
    }
    
    // PRE-SYNC VERSION SNAPSHOT — capture immutable state before sync
    appendVersion('daily_assessment', assessmentId, assessment, {
      beginning_of_day, end_of_day, operating_systems,
      equipment_checks, structure_checks, environment_checks,
    }, 'pre_sync').catch(() => {});

    // FIELD-COUNT REGRESSION GUARD — block sync if local data regressed significantly
    const currentFieldCount = calculateFieldCount(assessment, {
      beginning_of_day, end_of_day, operating_systems,
      equipment_checks, structure_checks, environment_checks,
    });
    const previousFieldCount = await getLatestFieldCount(assessmentId);
    if (previousFieldCount !== null && previousFieldCount > 0) {
      const dropPercent = ((previousFieldCount - currentFieldCount) / previousFieldCount) * 100;
      if (dropPercent > 50) {
        const skipCount = await incrementRegressionSkipCount(assessmentId);
        if (skipCount <= MAX_REGRESSION_SKIPS) {
          console.error('[SAFETY] Blocked assessment sync: field count regression >50%', {
            assessmentId: assessmentId.substring(0, 8),
            previousFieldCount,
            currentFieldCount,
            dropPercent: dropPercent.toFixed(1),
            skipCount,
            maxSkips: MAX_REGRESSION_SKIPS,
          });
          notifyRegressionBlock(
            'assessment',
            assessmentId,
            (assessment as any)?.organization || (assessment as any)?.site || '',
            skipCount,
          );
          return { success: false, skipped: true, reason: 'field_count_regression' };
        }
        console.warn('[SAFETY] Allowing assessment sync after max regression skips reached', {
          assessmentId: assessmentId.substring(0, 8),
          skipCount,
        });
        await resetRegressionSkipCount(assessmentId);
        notifyRegressionRelease();
      } else {
        await resetRegressionSkipCount(assessmentId);
        notifyRegressionRelease();
      }
    }

    // M15: Hard guard — fail loud if any temp- ID slipped past the transforms above.
    assertNoTempIds(assessment, 'daily_assessments.upsert');
    assertNoTempIdsInArray(beginning_of_day, 'daily_assessment_beginning_of_day.upsert');
    assertNoTempIdsInArray(end_of_day, 'daily_assessment_end_of_day.upsert');
    assertNoTempIdsInArray(operating_systems, 'daily_assessment_operating_systems.upsert');
    assertNoTempIdsInArray(equipment_checks, 'daily_assessment_equipment_checks.upsert');
    assertNoTempIdsInArray(structure_checks, 'daily_assessment_structure_checks.upsert');
    assertNoTempIdsInArray(environment_checks, 'daily_assessment_environment_checks.upsert');

    // 4. Build transaction steps
    const steps: TransactionStep[] = [];
    
    // Exclude joined objects - only column fields exist in DB
    const { inspector, ...assessmentWithoutJoin } = assessment as any;
    
    // For rollback, capture both synced_at and updated_at for proper state restoration
    const rollbackData = recordStatus?.record_exists 
      ? { synced_at: recordStatus.synced_at, updated_at: recordStatus.updated_at } 
      : null;
    
    // Step 1: Upsert assessment WITHOUT setting synced_at (defer to final step)
    // This ensures synced_at is only set after ALL related data is committed
    steps.push({
      table: 'daily_assessments',
      operation: 'upsert',
      data: {
        ...assessmentWithoutJoin,
        // DO NOT set synced_at here - it will be set in the final step
      },
      rollbackData,
    });
    
    let existingBeginning: any[] = [];
    let existingEnd: any[] = [];
    let existingSystems: any[] = [];
    let existingEquipment: any[] = [];
    let existingStructure: any[] = [];
    let existingEnvironment: any[] = [];

    // S25: skip 6x rollback prefetch when server row is at our last-known baseline
    const serverUnchangedSinceBaseline =
      !!assessment.synced_at &&
      !!recordStatus?.updated_at &&
      recordStatus.updated_at === assessment.synced_at;

    if (recordStatus?.record_exists && !recordStatus?.is_deleted && !serverUnchangedSinceBaseline) {
      [
        existingBeginning,
        existingEnd,
        existingSystems,
        existingEquipment,
        existingStructure,
        existingEnvironment
      ] = await Promise.all([
        fetchRollbackData('daily_assessment_beginning_of_day', { assessment_id: assessmentId }),
        fetchRollbackData('daily_assessment_end_of_day', { assessment_id: assessmentId }),
        fetchRollbackData('daily_assessment_operating_systems', { assessment_id: assessmentId }),
        fetchRollbackData('daily_assessment_equipment_checks', { assessment_id: assessmentId }),
        fetchRollbackData('daily_assessment_structure_checks', { assessment_id: assessmentId }),
        fetchRollbackData('daily_assessment_environment_checks', { assessment_id: assessmentId }),
      ]);
      
      const serverHasChildData = existingBeginning.length > 0 || existingEnd.length > 0 || 
        existingSystems.length > 0 || existingEquipment.length > 0 || 
        existingStructure.length > 0 || existingEnvironment.length > 0;
      const localIsCompletelyEmpty = beginning_of_day.length === 0 && end_of_day.length === 0 && 
        operating_systems.length === 0 && equipment_checks.length === 0 && 
        structure_checks.length === 0 && environment_checks.length === 0;
      
      if (serverHasChildData && localIsCompletelyEmpty && !wasClearedAfterLastSync(assessment)) {
        const serverCounts = {
          beginning: existingBeginning.length,
          end: existingEnd.length,
          systems: existingSystems.length,
          equipment: existingEquipment.length,
          structure: existingStructure.length,
          environment: existingEnvironment.length,
        };
        console.warn('[SAFETY] empty_local_guard: assessment server has child data but local is empty', {
          assessmentId,
          serverCounts,
        });

        // C2: Surface conflict instead of silently restoring server data.
        recordEmptyLocalConflictAndNotify(
          'daily_assessment',
          assessmentId,
          serverCounts,
          (assessment as any).organization || (assessment as any).site || undefined,
        );

        return { success: false, skipped: true, reason: 'empty_local_guard' };
      }
    }
    
    // SUSPICIOUS EMPTY GUARD: If record has been edited but ALL child data is empty,
    // this likely means IndexedDB reads failed silently. However, if we reach here,
    // the empty_local_guard above already verified the server ALSO has no child data
    // (or the record doesn't exist on server). So this is a legitimately blank form — allow sync.
    // Only block if the record wasn't checked by Guard 1 (i.e., doesn't exist on server).
    {
      const localIsCompletelyEmpty = beginning_of_day.length === 0 && end_of_day.length === 0 && 
        operating_systems.length === 0 && equipment_checks.length === 0 && 
        structure_checks.length === 0 && environment_checks.length === 0;
      const createdAt = new Date(assessment.created_at || assessment.updated_at).getTime();
      const updatedAt = new Date(assessment.updated_at).getTime();
      const ageMinutes = (Date.now() - createdAt) / 60000;
      const wasEdited = (updatedAt - createdAt) > 60000;

      if (localIsCompletelyEmpty && wasEdited && ageMinutes > 5) {
        // M4: If EVERY child IDB read failed, refuse to sync the empty payload.
        const allIdbReadsFailed =
          !assessmentIdbReadFlags.beginning_of_day &&
          !assessmentIdbReadFlags.end_of_day &&
          !assessmentIdbReadFlags.operating_systems &&
          !assessmentIdbReadFlags.equipment_checks &&
          !assessmentIdbReadFlags.structure_checks &&
          !assessmentIdbReadFlags.environment_checks;
        if (allIdbReadsFailed) {
          console.warn('[SAFETY] suspicious_empty_guard: all IDB child reads failed, skipping assessment sync', {
            assessmentId: assessmentId.substring(0, 8),
            ageMinutes: Math.round(ageMinutes),
          });
          return { success: false, skipped: true, reason: 'suspicious_empty_idb_read_failure' };
        }
        if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
          // Guard 1 already ran and didn't block — server is also empty. Allow sync.
          syncLog.log('[SYNC] suspicious_empty_guard: both local and server are empty, allowing sync for genuinely blank form', {
            assessmentId: assessmentId.substring(0, 8),
          });
        } else {
          // Record doesn't exist on server yet — new blank form, allow sync
          syncLog.log('[SYNC] suspicious_empty_guard: new record with no server data, allowing sync', {
            assessmentId: assessmentId.substring(0, 8),
          });
        }
      }
    }

    // Step 2: UPSERT child data first; reconcile (DELETE) is DEFERRED until
    // after the transaction commits (H3).
    let assessmentReconcileSpec: import('./deferred-reconcile').DeferredReconcileSpec[] | null = null;
    if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
      const pf = (arr: any[]) => (serverUnchangedSinceBaseline ? undefined : arr);
      assessmentReconcileSpec = [
        { childTable: 'daily_assessment_beginning_of_day', parentIdColumn: 'assessment_id', localItems: beginning_of_day, prefetchedServerRows: pf(existingBeginning), expectedNonEmpty: assessmentIdbReadFlags.beginning_of_day },
        { childTable: 'daily_assessment_end_of_day', parentIdColumn: 'assessment_id', localItems: end_of_day, prefetchedServerRows: pf(existingEnd), expectedNonEmpty: assessmentIdbReadFlags.end_of_day },
        { childTable: 'daily_assessment_operating_systems', parentIdColumn: 'assessment_id', localItems: operating_systems, prefetchedServerRows: pf(existingSystems), expectedNonEmpty: assessmentIdbReadFlags.operating_systems },
        { childTable: 'daily_assessment_equipment_checks', parentIdColumn: 'assessment_id', localItems: equipment_checks, prefetchedServerRows: pf(existingEquipment), expectedNonEmpty: assessmentIdbReadFlags.equipment_checks },
        { childTable: 'daily_assessment_structure_checks', parentIdColumn: 'assessment_id', localItems: structure_checks, prefetchedServerRows: pf(existingStructure), expectedNonEmpty: assessmentIdbReadFlags.structure_checks },
        { childTable: 'daily_assessment_environment_checks', parentIdColumn: 'assessment_id', localItems: environment_checks, prefetchedServerRows: pf(existingEnvironment), expectedNonEmpty: assessmentIdbReadFlags.environment_checks },
      ];
    }

    if (beginning_of_day.length > 0) {
      steps.push({
        table: 'daily_assessment_beginning_of_day',
        operation: 'upsert',
        data: beginning_of_day,
        rollbackData: existingBeginning,
      });
    }
    
    if (end_of_day.length > 0) {
      steps.push({
        table: 'daily_assessment_end_of_day',
        operation: 'upsert',
        data: end_of_day,
        rollbackData: existingEnd,
      });
    }
    
    if (operating_systems.length > 0) {
      steps.push({
        table: 'daily_assessment_operating_systems',
        operation: 'upsert',
        data: operating_systems,
        rollbackData: existingSystems,
      });
    }
    
    if (equipment_checks.length > 0) {
      steps.push({
        table: 'daily_assessment_equipment_checks',
        operation: 'upsert',
        data: equipment_checks,
        rollbackData: existingEquipment,
      });
    }
    
    if (structure_checks.length > 0) {
      steps.push({
        table: 'daily_assessment_structure_checks',
        operation: 'upsert',
        data: structure_checks,
        rollbackData: existingStructure,
      });
    }
    
    if (environment_checks.length > 0) {
      steps.push({
        table: 'daily_assessment_environment_checks',
        operation: 'upsert',
        data: environment_checks,
        rollbackData: existingEnvironment,
      });
    }
    
    // FINAL STEP: Set synced_at ONLY after all related data is successfully inserted
    // This is the atomic guarantee - synced_at only updates when everything commits
    steps.push({
      table: 'daily_assessments',
      operation: 'update',
      data: { synced_at: new Date().toISOString(), last_sync_source: 'main_thread' },
      filter: { id: assessmentId },
    });
    
    // 5. Execute transaction
    // S6: register self-write so the Realtime handler doesn't re-trigger sync from our own writes
    registerSelfWrite(assessmentId);
    const result = await executeTransaction(steps, { signal });
    
    if (!result.success) {
      // H3: nothing to compensate — reconcile is now deferred until AFTER the
      // transaction commits, so a failed upsert leaves the server untouched.
      throw new Error(`Transaction failed after ${result.completedSteps}/${result.totalSteps} steps. Rollback: ${result.rollbackSuccess ? 'successful' : 'failed'}`);
    }

    // H3: parent + children are committed; run deferred reconcile now.
    let assessmentReconcileBlocked = false;
    if (assessmentReconcileSpec) {
      const { runDeferredReconcile } = await import('./deferred-reconcile');
      const outcome = await runDeferredReconcile(
        assessmentReconcileSpec,
        assessmentId,
        'daily_assessment',
        user.id,
      );
      assessmentReconcileBlocked = outcome.result?.blocked === true || !outcome.ran;
    }
    
    // S4: Skip post-transaction verify SELECT — `executeTransaction` row-count guard +
    // `align_synced_at` failure-on-missing-row already provide the same guarantee.
    
    // 6. Get cached inspector profile to attach to offline data
    const inspectorProfile = await getCachedProfile(user.id);
    
    // POST-SYNC ALIGNMENT: Call align_synced_at RPC to set synced_at = updated_at on server
    registerSelfWrite(assessmentId); // S6: align_synced_at is a separate server write
    const { data: aligned, error: alignError } = await supabase.rpc('align_synced_at', {
      p_table_name: 'daily_assessments',
      p_record_id: assessmentId,
    });

    // S3: align_synced_at is ADVISORY. Transaction final step already wrote synced_at.
    // S14: on RPC failure, fetch server-authoritative timestamps instead of using client clock.
    let serverTimestamp: string;
    const alignedData = aligned as any;
    if (alignError || !alignedData || alignedData.error) {
      console.warn(
        '[Atomic Sync] align_synced_at non-fatal failure — fetching server timestamp',
        { table: 'daily_assessments', id: assessmentId, alignError: alignError?.message, aligned }
      );
      const { data: serverRow } = await supabase
        .from('daily_assessments')
        .select('updated_at, synced_at')
        .eq('id', assessmentId)
        .maybeSingle();
      serverTimestamp =
        (serverRow as any)?.synced_at ||
        (serverRow as any)?.updated_at ||
        (steps[steps.length - 1].data as any).synced_at;
    } else {
      serverTimestamp = alignedData.updated_at;
      syncLog.log(
        '%c[SYNC_TERMINAL] align_synced_at CONFIRMED %c%s',
        'color: #4ade80; font-family: monospace; font-weight: bold',
        'color: #86efac; font-family: monospace',
        `| table=daily_assessments | id=${assessmentId.substring(0,8)}... | ts=${serverTimestamp}`
      );
    }
    
    // C1: guard against clobbering an auto-save that landed during the round-trip.
    await safePostSyncSave(
      assessmentId,
      assessment,
      assessmentT0UpdatedAtMs,
      serverTimestamp,
      {
        user_cleared_at: null,
        inspector: inspectorProfile || { first_name: null, last_name: null, avatar_url: null },
      } as any,
      getOfflineDailyAssessment,
      saveDailyAssessmentOffline,
    );
    
    // 7. If we swapped a temp ID, clean up old IndexedDB entries
    if (assessmentIdMapping) {
      syncLog.log('[Atomic Sync] Cleaning up old temp-ID entries from IndexedDB:', assessmentIdMapping.oldId);
      
      // Delete old assessment entry keyed by temp ID
      await deleteOfflineDailyAssessment(assessmentIdMapping.oldId);
      
      // Clean up child record stores that were keyed under the old temp assessment_id
      const childStores = ['beginning_of_day', 'end_of_day', 'operating_systems', 'equipment_checks', 'structure_checks', 'environment_checks'] as const;
      for (const store of childStores) {
        await clearAssessmentDataOffline(store, assessmentIdMapping.oldId);
      }
      
      // Save child records under the new UUID
      await Promise.all([
        beginning_of_day.length > 0 ? saveAssessmentDataOffline('beginning_of_day', assessmentIdMapping.newId, beginning_of_day) : Promise.resolve(),
        end_of_day.length > 0 ? saveAssessmentDataOffline('end_of_day', assessmentIdMapping.newId, end_of_day) : Promise.resolve(),
        operating_systems.length > 0 ? saveAssessmentDataOffline('operating_systems', assessmentIdMapping.newId, operating_systems) : Promise.resolve(),
        equipment_checks.length > 0 ? saveAssessmentDataOffline('equipment_checks', assessmentIdMapping.newId, equipment_checks) : Promise.resolve(),
        structure_checks.length > 0 ? saveAssessmentDataOffline('structure_checks', assessmentIdMapping.newId, structure_checks) : Promise.resolve(),
        environment_checks.length > 0 ? saveAssessmentDataOffline('environment_checks', assessmentIdMapping.newId, environment_checks) : Promise.resolve(),
      ]);
      
      // Relink photos from temp ID to new UUID so syncPhotos() can upload them
      await relinkPhotosToNewInspectionId(assessmentIdMapping.oldId, assessmentIdMapping.newId);
    }
    
    // Clean up any queued assessment_operations entries for this assessment
    try {
      const queuedOps = await getQueuedAssessmentOperations();
      const matchingOps = queuedOps.filter(op => {
        const opAssessmentId = (op as any).assessmentId || op.data?.id;
        return opAssessmentId === assessmentId || (assessmentIdMapping && opAssessmentId === assessmentIdMapping.oldId);
      });
      for (const op of matchingOps) {
        await removeQueuedAssessmentOperation(op.id!);
      }
      if (matchingOps.length > 0 && import.meta.env.DEV) {
        syncLog.log(`[Atomic Sync] Cleaned up ${matchingOps.length} orphaned assessment_operations entries for ${assessmentId}`);
      }
    } catch (cleanupErr) {
      console.warn('[Atomic Sync] Non-blocking: failed to clean assessment_operations queue:', cleanupErr);
    }
    
    if (import.meta.env.DEV) {
      syncLog.log('[Atomic Sync] Successfully synced daily assessment with related data:', {
        assessmentId,
        stepsCompleted: result.completedSteps,
        totalSteps: result.totalSteps,
      });
    }
    
    return { success: true };
    
  } catch (error: any) {
    console.error('[Atomic Sync] Failed to sync daily assessment:', assessmentId, error);
    throw error;
  }
}

/**
 * Sync all unsynced daily assessments atomically
 */
export async function syncAllDailyAssessmentsAtomic(preValidatedUser?: CachedUser, signal?: AbortSignal) {
  const capabilities = getMobileCapabilities();
  const ITEM_SYNC_TIMEOUT = 25000; // 25 seconds per item max (increased for mobile networks)
  
  if (!navigator.onLine) {
    if (import.meta.env.DEV) {
      syncLog.log('[Atomic Sync] Offline - skipping daily assessment sync');
    }
    return { total: 0, success: 0, failed: 0, errors: [] };
  }

  // C5: Refuse to start a batch when the active session token is the offline
  // placeholder or otherwise invalid.
  if (!(await assertRealSessionForSync('daily_assessments'))) {
    return { total: 0, success: 0, failed: 0, errors: [] };
  }

  // Use pre-validated user if provided (avoids redundant LockManager calls)
  let user: CachedUser | null = preValidatedUser || null;
  if (!user) {
    // CRITICAL: Validate session before sync to ensure valid JWT for RLS
    try {
      user = await Promise.race([
        ensureValidSession(),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 8000))
      ]);
    } catch (e) {
      console.warn('[Atomic Sync] Session validation timed out for assessments, skipping');
      return { total: 0, success: 0, failed: 0, errors: [] };
    }
  }
  
  if (!user) {
    console.warn('[Atomic Sync] No valid session for assessment sync');
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  // S11: getUnsyncedDailyAssessments now returns IdbReadFailure on failure
  let unsynced: any[];
  let fetchFailureReason: string | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('IndexedDB timeout')), 15000)
    );
    
    const result = await Promise.race([
      getUnsyncedDailyAssessments(user.id),
      timeoutPromise
    ]);
    const { isIdbReadFailure } = await import('./offline-storage');
    if (isIdbReadFailure(result)) {
      fetchFailureReason = result.error;
      unsynced = [];
    } else {
      unsynced = result;
    }
  } catch (e: any) {
    if (e.message === 'IndexedDB timeout') {
      console.warn('[Atomic Sync] IndexedDB timeout getting unsynced assessments - will retry next cycle');
      fetchFailureReason = 'idb_outer_timeout';
    } else {
      console.warn('[Atomic Sync] Failed to get unsynced assessments:', e);
      fetchFailureReason = e?.message || 'unknown';
    }
    unsynced = [];
  }
  
  if (fetchFailureReason) {
    return { total: -1, success: 0, failed: 0, errors: [{ id: 'idb_read_failure', error: fetchFailureReason }] };
  }
  
  if (unsynced.length === 0) {
    if (import.meta.env.DEV) {
      syncLog.log('[Atomic Sync] No daily assessments to sync');
    }
    return { total: 0, success: 0, failed: 0, errors: [] };
  }
  
  // S7: Adaptive batch — grows on success, resets on failure
  const adaptiveSize = getCurrentBatchSize();
  const totalUnsynced = unsynced.length;
  const batch = unsynced.slice(0, adaptiveSize);
  const remaining = totalUnsynced - batch.length;

  if (import.meta.env.DEV) {
    syncLog.log('[Atomic Sync] Starting sync for unsynced daily assessments', {
      total: totalUnsynced,
      batchSize: batch.length,
      remaining,
      platform: capabilities.isIOS ? 'iOS' : capabilities.isAndroid ? 'Android' : 'Desktop',
    });
  }
  
  // Emit initial progress
  syncProgressEmitter.emit({
    total: batch.length,
    current: 0,
    currentItem: `Starting daily assessment sync... (${totalUnsynced} total pending)`,
    phase: 'assessments',
    errors: [],
  });
  
  let successCount = 0;
  let failCount = 0;
  const errors: Array<{ id: string; error: string }> = [];
  
  // Reduced retries for faster recovery
  const maxRetries = capabilities.isMobile ? 2 : 1;
  // S2: Bounded concurrency — different assessmentIds never share child rows.
  const itemConcurrency = capabilities.isMobile ? 3 : 5;
  let progressCounter = 0;

  await runWithConcurrency(batch, itemConcurrency, async (assessment, i) => {
    if (signal?.aborted) return;
    let retryCount = 0;
    let synced = false;

    while (retryCount < maxRetries && !synced && !signal?.aborted) {
      // Emit progress for current item
      progressCounter++;
      syncProgressEmitter.emit({
        total: batch.length,
        current: progressCounter,
        currentItem: `${formatProgressLabel([assessment.organization, assessment.site], 'Untitled assessment')}${retryCount > 0 ? ` (retry ${retryCount})` : ''}${remaining > 0 ? ` (${remaining} more queued)` : ''}`,
        phase: 'assessments',
        errors,
      });

      try {
        // Per-item timeout - pass pre-validated user to skip redundant session validation
        const itemResult = await Promise.race([
          syncDailyAssessmentAtomic(assessment.id, user as CachedUser, signal),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Item sync timeout')), ITEM_SYNC_TIMEOUT))
        ]);
        if (itemResult && typeof itemResult === 'object' && (itemResult as any).skipped) {
          synced = true;
        } else {
          successCount++;
          synced = true;
        }

        if (import.meta.env.DEV) {
          syncLog.log(`[Atomic Sync] Synced daily assessment ${i + 1}/${batch.length} (${remaining} remaining):`, assessment.id);
        }
      } catch (error: any) {
        retryCount++;

        if (retryCount < maxRetries) {
          const delay = Math.min(500 * retryCount, 2000);
          if (import.meta.env.DEV) {
            syncLog.log(`[Atomic Sync] Retry ${retryCount}/${maxRetries} for assessment ${assessment.id} after ${delay}ms`);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          failCount++;
          errors.push({ id: assessment.id, error: error.message });
          console.error('[Atomic Sync] Failed to sync daily assessment after retries:', assessment.id, error);
        }
      }
    }
  });
  
  syncLog.log('[Atomic Sync] Daily assessment sync results:', {
    batch: batch.length,
    totalPending: totalUnsynced,
    remaining,
    success: successCount,
    failed: failCount,
  });
  
}

// ============================================================================
// S12: Full-package refetch helpers.
// When a parent-row Realtime event survives shouldPreserveLocalRecord, we
// schedule a single round-trip that pulls parent + all child collections from
// the server and writes the package atomically into IDB. This keeps cross-
// device child-row edits in sync without subscribing to every child table.
// Self-write registration suppresses the resulting Realtime echo (S6).
// ============================================================================

async function fetchAllRows(table: string, parentColumn: string, parentId: string): Promise<any[]> {
  const { data, error } = await (supabase.from(table as any) as any)
    .select('*')
    .eq(parentColumn, parentId);
  if (error) throw error;
  return (data as any[]) || [];
}

export async function refetchInspectionPackage(inspectionId: string): Promise<void> {
  if (!navigator.onLine) return;
  try {
    const [{ data: inspection, error }, systems, ziplines, equipment, standards, summaryRows] = await Promise.all([
      supabase.from('inspections').select('*').eq('id', inspectionId).maybeSingle(),
      fetchAllRows('inspection_systems', 'inspection_id', inspectionId),
      fetchAllRows('inspection_ziplines', 'inspection_id', inspectionId),
      fetchAllRows('inspection_equipment', 'inspection_id', inspectionId),
      fetchAllRows('inspection_standards', 'inspection_id', inspectionId),
      fetchAllRows('inspection_summary', 'inspection_id', inspectionId),
    ]);
    if (error || !inspection) return;
    registerSelfWrite(inspectionId);
    // C1: refetched server payload — guard against a concurrent local edit
    // landing during the refetch round-trip (T0 here is the freshly-fetched server row).
    const refetchT0Ms = inspection.updated_at ? Date.parse(inspection.updated_at as string) : NaN;
    await safePostSyncSave(
      inspectionId,
      inspection as any,
      refetchT0Ms,
      (inspection as any).updated_at,
      {} as any,
      getOfflineInspection,
      saveInspectionOffline,
    );
    await Promise.all([
      clearRelatedDataOffline('systems', inspectionId).then(() => systems.length > 0 ? saveRelatedDataOffline('systems', inspectionId, systems) : null),
      clearRelatedDataOffline('ziplines', inspectionId).then(() => ziplines.length > 0 ? saveRelatedDataOffline('ziplines', inspectionId, ziplines) : null),
      clearRelatedDataOffline('equipment', inspectionId).then(() => equipment.length > 0 ? saveRelatedDataOffline('equipment', inspectionId, equipment) : null),
      clearRelatedDataOffline('standards', inspectionId).then(() => standards.length > 0 ? saveRelatedDataOffline('standards', inspectionId, standards) : null),
      clearRelatedDataOffline('summary', inspectionId).then(() => summaryRows.length > 0 ? saveRelatedDataOffline('summary', inspectionId, summaryRows) : null),
    ]);
    syncLog.log('[Atomic Sync] Refetched inspection package:', inspectionId);
  } catch (e) {
    console.warn('[Atomic Sync] refetchInspectionPackage failed (non-fatal):', e);
  }
}

export async function refetchTrainingPackage(trainingId: string): Promise<void> {
  if (!navigator.onLine) return;
  try {
    const [{ data: training, error }, da, os, ia, vi, sip, summary] = await Promise.all([
      supabase.from('trainings').select('*').eq('id', trainingId).maybeSingle(),
      fetchAllRows('training_delivery_approaches', 'training_id', trainingId),
      fetchAllRows('training_operating_systems', 'training_id', trainingId),
      fetchAllRows('training_immediate_attention', 'training_id', trainingId),
      fetchAllRows('training_verifiable_items', 'training_id', trainingId),
      fetchAllRows('training_systems_in_place', 'training_id', trainingId),
      fetchAllRows('training_summary', 'training_id', trainingId),
    ]);
    if (error || !training) return;
    registerSelfWrite(trainingId);
    // C1: see refetchInspectionPackage above.
    const refetchT0Ms = training.updated_at ? Date.parse(training.updated_at as string) : NaN;
    await safePostSyncSave(
      trainingId,
      training as any,
      refetchT0Ms,
      (training as any).updated_at,
      {} as any,
      getOfflineTraining,
      saveTrainingOffline,
    );
    await Promise.all([
      clearTrainingDataOffline('delivery_approaches', trainingId).then(() => da.length > 0 ? saveTrainingDataOffline('delivery_approaches', trainingId, da) : null),
      clearTrainingDataOffline('operating_systems', trainingId).then(() => os.length > 0 ? saveTrainingDataOffline('operating_systems', trainingId, os) : null),
      clearTrainingDataOffline('immediate_attention', trainingId).then(() => ia.length > 0 ? saveTrainingDataOffline('immediate_attention', trainingId, ia) : null),
      clearTrainingDataOffline('verifiable_items', trainingId).then(() => vi.length > 0 ? saveTrainingDataOffline('verifiable_items', trainingId, vi) : null),
      clearTrainingDataOffline('systems_in_place', trainingId).then(() => sip.length > 0 ? saveTrainingDataOffline('systems_in_place', trainingId, sip) : null),
      clearTrainingDataOffline('summary', trainingId).then(() => summary.length > 0 ? saveTrainingDataOffline('summary', trainingId, summary) : null),
    ]);
    syncLog.log('[Atomic Sync] Refetched training package:', trainingId);
  } catch (e) {
    console.warn('[Atomic Sync] refetchTrainingPackage failed (non-fatal):', e);
  }
}

export async function refetchAssessmentPackage(assessmentId: string): Promise<void> {
  if (!navigator.onLine) return;
  try {
    const [{ data: assessment, error }, bod, eod, opSys, eq, st, env] = await Promise.all([
      supabase.from('daily_assessments').select('*').eq('id', assessmentId).maybeSingle(),
      fetchAllRows('daily_assessment_beginning_of_day', 'assessment_id', assessmentId),
      fetchAllRows('daily_assessment_end_of_day', 'assessment_id', assessmentId),
      fetchAllRows('daily_assessment_operating_systems', 'assessment_id', assessmentId),
      fetchAllRows('daily_assessment_equipment_checks', 'assessment_id', assessmentId),
      fetchAllRows('daily_assessment_structure_checks', 'assessment_id', assessmentId),
      fetchAllRows('daily_assessment_environment_checks', 'assessment_id', assessmentId),
    ]);
    if (error || !assessment) return;
    registerSelfWrite(assessmentId);
    // C1: see refetchInspectionPackage above.
    const refetchT0Ms = assessment.updated_at ? Date.parse(assessment.updated_at as string) : NaN;
    await safePostSyncSave(
      assessmentId,
      assessment as any,
      refetchT0Ms,
      (assessment as any).updated_at,
      {} as any,
      getOfflineDailyAssessment,
      saveDailyAssessmentOffline,
    );
    await Promise.all([
      clearAssessmentDataOffline('beginning_of_day', assessmentId).then(() => bod.length > 0 ? saveAssessmentDataOffline('beginning_of_day', assessmentId, bod) : null),
      clearAssessmentDataOffline('end_of_day', assessmentId).then(() => eod.length > 0 ? saveAssessmentDataOffline('end_of_day', assessmentId, eod) : null),
      clearAssessmentDataOffline('operating_systems', assessmentId).then(() => opSys.length > 0 ? saveAssessmentDataOffline('operating_systems', assessmentId, opSys) : null),
      clearAssessmentDataOffline('equipment_checks', assessmentId).then(() => eq.length > 0 ? saveAssessmentDataOffline('equipment_checks', assessmentId, eq) : null),
      clearAssessmentDataOffline('structure_checks', assessmentId).then(() => st.length > 0 ? saveAssessmentDataOffline('structure_checks', assessmentId, st) : null),
      clearAssessmentDataOffline('environment_checks', assessmentId).then(() => env.length > 0 ? saveAssessmentDataOffline('environment_checks', assessmentId, env) : null),
    ]);
    syncLog.log('[Atomic Sync] Refetched assessment package:', assessmentId);
  } catch (e) {
    console.warn('[Atomic Sync] refetchAssessmentPackage failed (non-fatal):', e);
  }
}
