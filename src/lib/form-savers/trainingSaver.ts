/**
 * Pure save helpers for TrainingForm.
 *
 * Slice 2 of the TrainingForm decomposition.
 *
 * IMPORTANT: This module owns NO React state, NO refs, NO mutex, NO debounce.
 * Those live in `src/pages/TrainingForm.tsx` because they coordinate UI
 * (Auto-save and Immediate-save-on-blur) — moving them out would silently
 * break persistence. This module only exposes pure-ish async functions that
 * do the IDB writes and the network writes.
 *
 * Caller contract:
 *   1. Call `persistTrainingToOffline` first. It always writes the
 *      localStorage snapshot, then writes IDB child rows in parallel, then
 *      fire-and-forget appends a version-history entry.
 *   2. If `isOnline`, call `pushTrainingToRemote`. It returns the
 *      `syncTimestamp` confirmed by the server. The caller is responsible
 *      for then writing `{ ...updatedTraining, synced_at: syncTimestamp }`
 *      back to IDB and marking the snapshot synced.
 *   3. On any throw from `pushTrainingToRemote`, the caller should queue a
 *      `queueTrainingOperation('update', id, updatedTraining)` for later
 *      retry. The saver does not queue — that's a page-level recovery
 *      decision.
 */
import { supabase } from "@/integrations/supabase/client";
import type { PostgrestError } from "@supabase/supabase-js";
import {
  saveTrainingOffline,
  saveTrainingDataOffline,
  type DbRow,
} from "@/lib/offline-storage";
import { saveReportSnapshot } from "@/lib/local-backup-ledger";
import { appendVersion } from "@/lib/report-version-manager";
import {
  reconcileAllChildTables,
  restoreReconciledDeletions,
  type ReconciledTableDelete,
} from "@/lib/sync-reconciliation";
import { getUserWithCache } from "@/lib/cached-auth";

// ---- Types ----------------------------------------------------------------

export interface TrainingSavePayload {
  id: string;
  training: DbRow;
  deliveryApproaches: DbRow[];
  operatingSystems: DbRow[];
  immediateAttention: DbRow[];
  verifiableItems: DbRow[];
  systemsInPlace: DbRow[];
  summary: DbRow | null;
}

export interface ChildLoadedFlags {
  delivery_approaches: boolean;
  operating_systems: boolean;
  immediate_attention: boolean;
  verifiable_items: boolean;
  systems_in_place: boolean;
  summary: boolean;
}

export interface PersistResult {
  /** The training row as written to IDB (timestamp + clear-intent already applied). */
  updatedTraining: DbRow;
  totalChildCount: number;
  /** True when the IDB child writes resolved without an IdbSaveError. */
  localSaveSucceeded: boolean;
  /** The error thrown by the child writes, if any (caller decides whether to surface it). */
  offlineError?: unknown;
}

export interface RemoteSyncResult {
  syncTimestamp: string;
}

// ---- Pure helpers ---------------------------------------------------------

/**
 * Strip IDB-only fields before sending to Supabase.
 *
 * Keep in sync with `atomic-sync-manager.ts:LOCAL_ONLY_REMOTE_UPSERT_FIELDS`
 * and the equivalent helper in `InspectionForm.performSave`.
 */
export function sanitizeTrainingForRemote(
  t: Record<string, unknown>,
): Record<string, unknown> {
  const {
    id: _id,
    created_at: _created_at,
    child_count_hint: _child_count_hint,
    dirty: _dirty,
    ...rest
  } = t;
  void _id; void _created_at; void _child_count_hint; void _dirty;
  return rest;
}

/**
 * Replace temp-IDs with real UUIDs and stamp the foreign key.
 * Pure; no IDB or network.
 */
export function prepareTrainingChildItems<T extends { id?: string }>(
  items: T[],
  parentId: string,
): Array<T & { id: string; training_id: string }> {
  return items.map((item) => ({
    ...item,
    id: item.id?.startsWith("temp-")
      ? crypto.randomUUID()
      : item.id || crypto.randomUUID(),
    training_id: parentId,
  }));
}

// ---- Offline persistence --------------------------------------------------

/**
 * Writes the training + all child rows to IDB and appends a version history
 * entry (fire-and-forget). Always writes the localStorage snapshot first so
 * Force Local Backup has something to grab even if IDB throws.
 */
export async function persistTrainingToOffline(
  payload: TrainingSavePayload,
  opts: {
    currentUserId?: string;
    childDataLoaded: ChildLoadedFlags;
    silent: boolean;
    onVersionAppended?: (info: { versionNumber: number; fieldCount: number }) => void;
  },
): Promise<PersistResult> {
  const {
    id, training,
    deliveryApproaches, operatingSystems, immediateAttention,
    verifiableItems, systemsInPlace, summary,
  } = payload;
  const { currentUserId, childDataLoaded, silent, onVersionAppended } = opts;

  // Stamp updated_at + last_modified_by (when current user isn't the owner)
  const baseUpdatedTraining: DbRow = {
    ...training,
    updated_at: new Date().toISOString(),
    ...(currentUserId && currentUserId !== training.inspector_id
      ? { last_modified_by: currentUserId }
      : {}),
  };

  // S9: Reconcile user-clear intent across all child collections + summary.
  const summaryHasContent = !!(summary && (summary.observations || summary.recommendations));
  const totalChildCount =
    deliveryApproaches.length + operatingSystems.length +
    immediateAttention.length + verifiableItems.length +
    systemsInPlace.length + (summaryHasContent ? 1 : 0);

  const { reconcileClearIntent } = await import("@/lib/clear-intent");
  const updatedTraining: DbRow = reconcileClearIntent(
    baseUpdatedTraining,
    totalChildCount,
    !!baseUpdatedTraining.synced_at,
  );

  // Layer 1: localStorage snapshot FIRST (always reliable, runs before IDB)
  try {
    saveReportSnapshot("training", id, updatedTraining, {
      delivery_approaches: deliveryApproaches,
      operating_systems: operatingSystems,
      immediate_attention: immediateAttention,
      verifiable_items: verifiableItems,
      systems_in_place: systemsInPlace,
      summary: summary ? [summary] : [],
    }, false);
  } catch { /* snapshot is best-effort */ }

  // Build IDB write batch — only include child arrays that were confirmed
  // loaded (or have items now), so an empty-on-load doesn't clobber server data.
  const childOps: Promise<unknown>[] = [
    saveTrainingOffline(updatedTraining, { childCountHint: totalChildCount }),
  ];
  const maybePush = (
    key: keyof ChildLoadedFlags,
    items: DbRow[],
  ) => {
    if (items.length > 0 || childDataLoaded[key]) {
      childOps.push(saveTrainingDataOffline(key as never, id, items, { allowEmpty: true }));
    } else if (typeof console !== "undefined") {
      console.warn(`[Training Save] Skipping ${key} save — empty array not confirmed as loaded`);
    }
  };
  maybePush("delivery_approaches", deliveryApproaches);
  maybePush("operating_systems", operatingSystems);
  maybePush("immediate_attention", immediateAttention);
  maybePush("verifiable_items", verifiableItems);
  maybePush("systems_in_place", systemsInPlace);
  if (summary && (childDataLoaded.summary || summary.observations || summary.recommendations)) {
    childOps.push(saveTrainingDataOffline("summary" as never, id, summary as unknown as DbRow[]));
  }

  let localSaveSucceeded = false;
  let offlineError: unknown;
  try {
    await Promise.all(childOps);
    localSaveSucceeded = true;

    // Layer 2: append-only version history (fire-and-forget, metadata only)
    appendVersion("training", id, updatedTraining, {
      delivery_approaches: deliveryApproaches,
      operating_systems: operatingSystems,
      immediate_attention: immediateAttention,
      verifiable_items: verifiableItems,
      systems_in_place: systemsInPlace,
      summary: summary ? [summary] : [],
    }, silent ? "auto_save" : "manual_save")
      .then((v) => { if (v) onVersionAppended?.({ versionNumber: v.versionNumber, fieldCount: v.fieldCount }); })
      .catch(() => {});
  } catch (err) {
    offlineError = err;
  }

  return { updatedTraining, totalChildCount, localSaveSucceeded, offlineError };
}

// ---- Remote sync ----------------------------------------------------------

/**
 * Pushes the training and its child tables to Supabase. Returns the
 * server-confirmed `synced_at` timestamp. Throws on any failure; caller
 * is expected to fall back to `queueTrainingOperation`.
 *
 * Uses the deferred-`synced_at` pattern: the parent is updated WITHOUT
 * `synced_at`, all children are upserted in parallel, then a final
 * `synced_at` update is verified.
 */
export async function pushTrainingToRemote(
  payload: TrainingSavePayload,
  opts: { updatedTraining: DbRow },
): Promise<RemoteSyncResult> {
  const {
    id,
    deliveryApproaches, operatingSystems, immediateAttention,
    verifiableItems, systemsInPlace, summary,
  } = payload;
  const { updatedTraining } = opts;

  const sanitizedTraining = sanitizeTrainingForRemote(
    updatedTraining as Record<string, unknown>,
  );

  // Update main training row WITHOUT synced_at (deferred pattern)
  const { data: updateResult, error: trainingError } = await supabase
    .from("trainings")
    .update(sanitizedTraining as never)
    .eq("id", id)
    .select("id");
  if (trainingError) throw trainingError;

  // 0-row update => the parent row doesn't exist yet on the server; upsert.
  if (!updateResult || updateResult.length === 0) {
    console.warn("[Training Save] Update returned 0 rows — falling back to upsert");
    const { error: upsertError } = await supabase
      .from("trainings")
      .upsert({ id, ...sanitizedTraining } as never);
    if (upsertError) throw upsertError;
  }

  // Reconcile (delete server rows the user removed locally) BEFORE upserting
  // — so we capture pre-images for restoreOnFailure.
  let reconciledDeletes: ReconciledTableDelete[] = [];
  const user = await getUserWithCache();
  if (user) {
    const reconcileResult = await reconcileAllChildTables(
      [
        { childTable: "training_delivery_approaches", parentIdColumn: "training_id", localItems: deliveryApproaches },
        { childTable: "training_operating_systems", parentIdColumn: "training_id", localItems: operatingSystems },
        { childTable: "training_immediate_attention", parentIdColumn: "training_id", localItems: immediateAttention },
        { childTable: "training_verifiable_items", parentIdColumn: "training_id", localItems: verifiableItems },
        { childTable: "training_systems_in_place", parentIdColumn: "training_id", localItems: systemsInPlace },
        { childTable: "training_summary", parentIdColumn: "training_id", localItems: summary ? [summary] : [] },
      ],
      id,
      "training",
      user.id,
    );
    reconciledDeletes = reconcileResult.deletedByTable;
  }

  // Helper: convert PromiseLike<{error}> into Promise<void>.
  const dbOp = async (
    operation: PromiseLike<{ error: PostgrestError | null }>,
  ) => {
    const { error } = await operation;
    if (error) throw error;
  };

  const preparedApproaches = prepareTrainingChildItems(deliveryApproaches, id);
  const preparedSystems = prepareTrainingChildItems(operatingSystems, id);
  const preparedAttention = prepareTrainingChildItems(immediateAttention, id);
  const preparedVerifiable = prepareTrainingChildItems(verifiableItems, id);
  const preparedSystemsPlace = prepareTrainingChildItems(systemsInPlace, id);

  const parallelOps: Promise<void>[] = [];
  if (preparedApproaches.length > 0) {
    parallelOps.push(dbOp(supabase.from("training_delivery_approaches").upsert(preparedApproaches as never, { onConflict: "id" })));
  }
  if (preparedSystems.length > 0) {
    parallelOps.push(dbOp(supabase.from("training_operating_systems").upsert(preparedSystems as never, { onConflict: "id" })));
  }
  if (preparedAttention.length > 0) {
    parallelOps.push(dbOp(supabase.from("training_immediate_attention").upsert(preparedAttention as never, { onConflict: "id" })));
  }
  if (preparedVerifiable.length > 0) {
    parallelOps.push(dbOp(supabase.from("training_verifiable_items").upsert(preparedVerifiable as never, { onConflict: "id" })));
  }
  if (preparedSystemsPlace.length > 0) {
    parallelOps.push(dbOp(supabase.from("training_systems_in_place").upsert(preparedSystemsPlace as never, { onConflict: "id" })));
  }
  if (summary) {
    const preparedSummary = {
      ...summary,
      id: summary.id || crypto.randomUUID(),
      training_id: id,
    };
    parallelOps.push(dbOp(supabase.from("training_summary").upsert(preparedSummary as never, { onConflict: "training_id" })));
  }

  // C4: parallel upsert(s) failed — restore the rows reconcile already deleted.
  try {
    await Promise.all(parallelOps);
  } catch (parErr) {
    if (reconciledDeletes.length > 0) {
      try {
        await restoreReconciledDeletions(reconciledDeletes, id);
      } catch (restoreErr) {
        console.error("[C4] TrainingForm: restoreReconciledDeletions threw", restoreErr);
      }
    }
    throw parErr;
  }

  // DEFERRED: set synced_at ONLY after all child data committed
  const syncTimestamp = new Date().toISOString();
  const { data: verifyData, error: finalSyncError } = await supabase
    .from("trainings")
    .update({ synced_at: syncTimestamp })
    .eq("id", id)
    .select("id, synced_at");

  if (finalSyncError || !verifyData?.length) {
    console.error("[Training Save] Post-sync verification failed:", finalSyncError);
    throw new Error("Sync verification failed: server did not confirm synced_at update");
  }

  return { syncTimestamp };
}
