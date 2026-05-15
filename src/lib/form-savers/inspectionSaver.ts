/**
 * Pure save helpers for InspectionForm.
 *
 * Slice 1 of the InspectionForm decomposition. Mirrors trainingSaver.ts
 * (which has been battle-tested in production via the Training refactor).
 *
 * IMPORTANT: This module owns NO React state, NO refs, NO mutex, NO debounce.
 * Those live in `src/pages/InspectionForm.tsx` because they coordinate UI
 * (Auto-save + Immediate-save-on-blur). Moving them out would silently
 * break persistence.
 *
 * Caller contract:
 *   1. Call `persistInspectionToOffline` first. It always writes the
 *      localStorage snapshot, then writes IDB child rows in parallel, then
 *      fire-and-forget appends a version-history entry. It also stamps
 *      updated_at, last_modified_by (when applicable), and reconciles
 *      user-clear intent (S9) — these depend only on the payload.
 *   2. If `isOnline`, call `pushInspectionToRemote`. It returns the
 *      server-confirmed `synced_at` timestamp plus the temp→real id maps
 *      for the caller to apply via setState in a queueMicrotask.
 *      The caller is then responsible for writing
 *      `{ ...updatedInspection, synced_at: syncTimestamp }` back to IDB and
 *      calling `markSnapshotSynced`.
 *   3. On any throw from `pushInspectionToRemote`, the caller should rely
 *      on IDB drift (updated_at > synced_at) to trigger a retry on the next
 *      auto-sync cycle. The saver does not queue.
 */
import { supabase } from "@/integrations/supabase/client";
import type { PostgrestError } from "@supabase/supabase-js";
import {
  saveInspectionOffline,
  saveRelatedDataOffline,
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

export interface InspectionSavePayload {
  id: string;
  inspection: DbRow;
  systems: DbRow[];
  ziplines: DbRow[];
  equipment: DbRow[];
  standards: DbRow[];
  /** Single summary object — caller passes summaryRef.current. */
  summary: DbRow;
}

export interface ChildLoadedFlags {
  systems: boolean;
  ziplines: boolean;
  equipment: boolean;
  standards: boolean;
  summary: boolean;
}

export interface PersistResult {
  /** The inspection row as written to IDB (timestamp + clear-intent applied). */
  updatedInspection: DbRow;
  totalChildCount: number;
  /** True when the IDB child writes resolved without an IdbSaveError. */
  localSaveSucceeded: boolean;
  /** The error thrown by the child writes, if any (caller decides whether to surface it). */
  offlineError?: unknown;
}

/**
 * Maps from old temp-id → new server-assigned UUID, per child table.
 * Caller applies these via setState in a queueMicrotask, preserving live
 * field edits the user may have made between snapshot and microtask.
 */
export interface TempIdMappings {
  systems: Map<string, { id: string; inspection_id: string }>;
  ziplines: Map<string, { id: string; inspection_id: string }>;
  equipment: Map<string, { id: string; inspection_id: string }>;
}

export interface RemoteSyncResult {
  syncTimestamp: string;
  /** True when at least one local child was filtered out (empty name) before remote upsert. */
  hadFilteredItems: boolean;
  tempIdMappings: TempIdMappings;
}

// ---- Pure helpers ---------------------------------------------------------

/**
 * Strip IDB-only and joined fields before sending to Supabase.
 *
 * Keep in sync with `atomic-sync-manager.ts:LOCAL_ONLY_REMOTE_UPSERT_FIELDS`
 * and the equivalent helper in `trainingSaver.ts`.
 */
export function sanitizeInspectionForRemote(
  insp: Record<string, unknown>,
): Record<string, unknown> {
  const {
    id: _id,
    inspector: _inspector,
    created_at: _created_at,
    child_count_hint: _child_count_hint,
    dirty: _dirty,
    inspection_id: _inspection_id,
    user_id: _user_id,
    ...rest
  } = insp;
  void _id;
  void _inspector;
  void _created_at;
  void _child_count_hint;
  void _dirty;
  void _inspection_id;
  void _user_id;
  return {
    ...rest,
    previous_inspection_date:
      (rest as { previous_inspection_date?: string | null }).previous_inspection_date === ""
        ? null
        : (rest as { previous_inspection_date?: string | null }).previous_inspection_date,
  };
}

/**
 * Strip empty-string next_inspection_date.
 */
export function sanitizeSummaryForRemote(sum: DbRow): DbRow {
  return {
    ...sum,
    next_inspection_date:
      (sum as { next_inspection_date?: string | null }).next_inspection_date === ""
        ? null
        : (sum as { next_inspection_date?: string | null }).next_inspection_date,
  } as DbRow;
}

// ---- Offline persistence --------------------------------------------------

/**
 * Writes the inspection + all child rows to IDB and appends a version
 * history entry (fire-and-forget). Always writes the localStorage snapshot
 * first so Force Local Backup has something to grab even if IDB throws.
 */
export async function persistInspectionToOffline(
  payload: InspectionSavePayload,
  opts: {
    currentUserId?: string;
    childDataLoaded: ChildLoadedFlags;
    silent: boolean;
    onVersionAppended?: (info: { versionNumber: number; fieldCount: number }) => void;
    /**
     * Fires synchronously the moment the localStorage snapshot is written —
     * BEFORE the IDB child writes resolve. Mirrors the legacy ordering where
     * `showHardSavedToast` fires immediately after the snapshot so the toast
     * appears even if IDB hangs.
     */
    onSnapshotSaved?: () => void;
  },
): Promise<PersistResult> {
  const { id, inspection, systems, ziplines, equipment, standards, summary } = payload;
  const { currentUserId, childDataLoaded, silent, onVersionAppended, onSnapshotSaved } = opts;

  // Stamp updated_at + last_modified_by (when current user isn't the owner)
  const baseInspectionToSave: DbRow = {
    ...inspection,
    updated_at: new Date().toISOString(),
    ...(currentUserId && currentUserId !== inspection.inspector_id
      ? { last_modified_by: currentUserId }
      : {}),
  };

  // S9: Reconcile user-clear intent. If the user has emptied every section
  // of a previously-synced inspection, stamp `user_cleared_at` so the sync
  // pipeline doesn't restore the server copy back into IDB.
  const summaryHasAnyContent = !!(
    summary &&
    ((summary as DbRow).repairs_performed ||
      (summary as DbRow).critical_actions ||
      (summary as DbRow).future_considerations ||
      (summary as DbRow).next_inspection_date)
  );
  const totalChildCount =
    systems.length +
    ziplines.length +
    equipment.length +
    standards.length +
    (summaryHasAnyContent ? 1 : 0);

  const { reconcileClearIntent } = await import("@/lib/clear-intent");
  const updatedInspection: DbRow = reconcileClearIntent(
    baseInspectionToSave,
    totalChildCount,
    !!baseInspectionToSave.synced_at,
  );

  // Layer 1: localStorage snapshot FIRST (always reliable, runs before IDB)
  try {
    saveReportSnapshot(
      "inspection",
      id,
      updatedInspection,
      { systems, ziplines, equipment, standards, summary: [summary] },
      !!updatedInspection.synced_at,
    );
  } catch {
    /* snapshot is best-effort */
  }
  // Fire snapshot-saved callback BEFORE IDB child writes (matches legacy ordering)
  try { onSnapshotSaved?.(); } catch { /* never let toast throw */ }

  // Build IDB write batch — only include child arrays that were confirmed
  // loaded (or have items now), so an empty-on-load doesn't clobber server
  // data. Mirrors the legacy guard in InspectionForm.performSave.
  const childOps: Promise<unknown>[] = [
    saveInspectionOffline(updatedInspection, { childCountHint: totalChildCount }),
  ];
  const maybePush = (
    key: keyof ChildLoadedFlags,
    items: DbRow[],
    withDisplayOrder: boolean,
  ) => {
    if (items.length > 0 || childDataLoaded[key]) {
      const stamped = withDisplayOrder
        ? items.map((it, i) => ({ ...it, display_order: i }))
        : items;
      childOps.push(
        saveRelatedDataOffline(key as never, id, stamped, { allowEmpty: true }),
      );
    } else if (typeof console !== "undefined") {
      console.warn(
        `[InspectionForm Save] Skipping ${key} save — empty array not confirmed as loaded`,
      );
    }
  };
  maybePush("systems", systems, true);
  maybePush("ziplines", ziplines, true);
  maybePush("equipment", equipment, true);
  maybePush("standards", standards, false);
  // Summary is always written if loaded — keep parity with legacy.
  if (childDataLoaded.summary || summary) {
    childOps.push(
      saveRelatedDataOffline("summary" as never, id, [summary], { allowEmpty: true }),
    );
  }

  let localSaveSucceeded = false;
  let offlineError: unknown;
  try {
    await Promise.all(childOps);
    localSaveSucceeded = true;

    // Layer 2: append-only version history (fire-and-forget, metadata only)
    appendVersion(
      "inspection",
      id,
      updatedInspection,
      { systems, ziplines, equipment, standards, summary: [summary] },
      silent ? "auto_save" : "manual_save",
    )
      .then((v) => {
        if (v) onVersionAppended?.({ versionNumber: v.versionNumber, fieldCount: v.fieldCount });
      })
      .catch(() => {});
  } catch (err) {
    offlineError = err;
  }

  return { updatedInspection, totalChildCount, localSaveSucceeded, offlineError };
}

// ---- Remote sync ----------------------------------------------------------

/**
 * Pushes the inspection and its child tables to Supabase. Returns the
 * server-confirmed `synced_at` timestamp + the temp-id mappings the page
 * should apply via setState. Throws on any failure; caller relies on IDB
 * drift to trigger a retry on the next auto-sync cycle.
 *
 * Reconcile-then-upsert with C4 rollback (`restoreReconciledDeletions`) on
 * parallel-upsert failure — preserves the legacy InspectionForm contract.
 */
export async function pushInspectionToRemote(
  payload: InspectionSavePayload,
  opts: { updatedInspection: DbRow },
): Promise<RemoteSyncResult> {
  const { id, systems, ziplines, equipment, standards, summary } = payload;
  const { updatedInspection } = opts;

  const sanitized = sanitizeInspectionForRemote(
    updatedInspection as unknown as Record<string, unknown>,
  );

  // Update main inspection row WITHOUT synced_at (deferred pattern)
  const { data: updateResult, error: inspectionError } = await supabase
    .from("inspections")
    .update(sanitized as never)
    .eq("id", id)
    .select("id");

  if (inspectionError) {
    console.error("[InspectionForm Sync] Failed to update inspection:", inspectionError);
    throw inspectionError;
  }

  // 0-row update => the parent row doesn't exist yet on the server; upsert.
  if (!updateResult || updateResult.length === 0) {
    console.warn("[InspectionForm Sync] Update returned 0 rows — falling back to upsert");
    const { error: upsertError } = await supabase
      .from("inspections")
      .upsert({ id, ...sanitized } as never);
    if (upsertError) {
      console.error("[InspectionForm Sync] Upsert fallback failed:", upsertError);
      throw upsertError;
    }
  }

  // Pre-generate UUIDs for new items + stamp display_order.
  const systemsWithOrder = systems.map((s, i) => ({ ...s, display_order: i }));
  const ziplinesWithOrder = ziplines.map((z, i) => ({ ...z, display_order: i }));
  const equipmentWithOrder = equipment.map((e, i) => ({ ...e, display_order: i }));

  const existingSystems = systemsWithOrder.filter((s) => s.id && !s.id.startsWith("temp-"));
  const newSystems = systemsWithOrder
    .filter((s) => !s.id || s.id.startsWith("temp-"))
    .map((s) => ({ ...s, id: crypto.randomUUID(), inspection_id: id }));

  const existingZiplines = ziplinesWithOrder.filter((z) => z.id && !z.id.startsWith("temp-"));
  const newZiplines = ziplinesWithOrder
    .filter((z) => !z.id || z.id.startsWith("temp-"))
    .map((z) => ({ ...z, id: crypto.randomUUID(), inspection_id: id }));

  const existingEquipment = equipmentWithOrder.filter((e) => e.id && !e.id.startsWith("temp-"));
  const newEquipment = equipmentWithOrder
    .filter((e) => !e.id || e.id.startsWith("temp-"))
    .map((e) => ({ ...e, id: crypto.randomUUID(), inspection_id: id }));

  const standardsWithIds = standards.map((s) => ({
    ...s,
    id: s.id || crypto.randomUUID(),
    inspection_id: id,
  }));

  // RECONCILE: Delete server rows removed locally before upserting.
  // C4: capture pre-images so we can restore them if the parallel upserts fail.
  let inspReconciledDeletes: ReconciledTableDelete[] = [];
  const user = await getUserWithCache();
  if (user) {
    const reconcileResult = await reconcileAllChildTables(
      [
        { childTable: "inspection_systems", parentIdColumn: "inspection_id", localItems: systems },
        { childTable: "inspection_ziplines", parentIdColumn: "inspection_id", localItems: ziplines },
        { childTable: "inspection_equipment", parentIdColumn: "inspection_id", localItems: equipment },
        { childTable: "inspection_standards", parentIdColumn: "inspection_id", localItems: standards },
        { childTable: "inspection_summary", parentIdColumn: "inspection_id", localItems: summary ? [summary] : [] },
      ],
      id,
      "inspection",
      user.id,
    );
    inspReconciledDeletes = reconcileResult.deletedByTable;
  }

  // Helper: convert PromiseLike<{error}> into Promise<void>.
  const dbOp = async (operation: PromiseLike<{ error: PostgrestError | null }>) => {
    const { error } = await operation;
    if (error) throw error;
  };

  // Build temp-id → new-record maps (page applies via queueMicrotask).
  const systemsMap: TempIdMappings["systems"] = new Map();
  systems
    .filter((s) => !s.id || s.id.startsWith("temp-"))
    .forEach((original, i) => {
      if (newSystems[i]) {
        systemsMap.set(original.id || "", {
          id: newSystems[i].id,
          inspection_id: newSystems[i].inspection_id,
        });
      }
    });

  const ziplinesMap: TempIdMappings["ziplines"] = new Map();
  ziplines
    .filter((z) => !z.id || z.id.startsWith("temp-"))
    .forEach((original, i) => {
      if (newZiplines[i]) {
        ziplinesMap.set(original.id || "", {
          id: newZiplines[i].id,
          inspection_id: newZiplines[i].inspection_id,
        });
      }
    });

  const equipmentMap: TempIdMappings["equipment"] = new Map();
  equipment
    .filter((e) => !e.id || e.id.startsWith("temp-"))
    .forEach((original, i) => {
      if (newEquipment[i]) {
        equipmentMap.set(original.id || "", {
          id: newEquipment[i].id,
          inspection_id: newEquipment[i].inspection_id,
        });
      }
    });

  const parallelOps: Promise<void>[] = [];
  if (existingSystems.length > 0) {
    parallelOps.push(
      dbOp(
        supabase
          .from("inspection_systems")
          .upsert(
            existingSystems.map((s) => ({ ...s, inspection_id: id })) as never,
            { onConflict: "id" },
          ),
      ),
    );
  }
  if (newSystems.length > 0) {
    parallelOps.push(dbOp(supabase.from("inspection_systems").insert(newSystems as never)));
  }
  if (existingZiplines.length > 0) {
    parallelOps.push(
      dbOp(
        supabase
          .from("inspection_ziplines")
          .upsert(
            existingZiplines.map((z) => ({ ...z, inspection_id: id })) as never,
            { onConflict: "id" },
          ),
      ),
    );
  }
  if (newZiplines.length > 0) {
    parallelOps.push(dbOp(supabase.from("inspection_ziplines").insert(newZiplines as never)));
  }
  if (existingEquipment.length > 0) {
    parallelOps.push(
      dbOp(
        supabase
          .from("inspection_equipment")
          .upsert(
            existingEquipment.map((e) => ({ ...e, inspection_id: id })) as never,
            { onConflict: "id" },
          ),
      ),
    );
  }
  if (newEquipment.length > 0) {
    parallelOps.push(dbOp(supabase.from("inspection_equipment").insert(newEquipment as never)));
  }

  // Standards: upsert (atomic; never delete+insert).
  parallelOps.push(
    dbOp(
      supabase
        .from("inspection_standards")
        .upsert(standardsWithIds as never, { onConflict: "id", ignoreDuplicates: false }),
    ),
  );

  // Summary
  parallelOps.push(
    dbOp(
      supabase
        .from("inspection_summary")
        .upsert(
          sanitizeSummaryForRemote({
            ...summary,
            id: summary.id && !(summary.id as string).startsWith("temp-") ? summary.id : crypto.randomUUID(),
            inspection_id: id,
          } as DbRow) as never,
          { onConflict: "inspection_id" },
        ),
    ),
  );

  try {
    await Promise.all(parallelOps);
  } catch (parErr) {
    // C4: parallel upsert(s) failed — restore the rows reconcile already deleted.
    if (inspReconciledDeletes.length > 0) {
      try {
        await restoreReconciledDeletions(inspReconciledDeletes, id);
      } catch (restoreErr) {
        console.error("[C4] InspectionForm: restoreReconciledDeletions threw", restoreErr);
      }
    }
    throw parErr;
  }

  // hadFilteredItems mirrors legacy: items dropped by name-empty filter
  // before remote write. We compute against the unfiltered local arrays.
  const validSystemsCount = systems.filter((s) => s.system_name && s.system_name.trim() !== "").length;
  const validZiplinesCount = ziplines.filter((z) => z.zipline_name && z.zipline_name.trim() !== "").length;
  const validEquipmentCount = equipment.filter(
    (e) => e.equipment_type && e.equipment_type.trim() !== "",
  ).length;
  const hadFilteredItems =
    validSystemsCount !== systems.length ||
    validZiplinesCount !== ziplines.length ||
    validEquipmentCount !== equipment.length;

  // DEFERRED: set synced_at ONLY after all child data committed.
  const syncTimestamp = new Date().toISOString();
  const { data: verifyData, error: finalSyncError } = await supabase
    .from("inspections")
    .update({ synced_at: syncTimestamp })
    .eq("id", id)
    .select("id, synced_at");

  if (finalSyncError || !verifyData?.length) {
    console.error("[InspectionForm Sync] Post-sync verification failed:", finalSyncError);
    throw new Error("Sync verification failed: server did not confirm synced_at update");
  }

  return {
    syncTimestamp,
    hadFilteredItems,
    tempIdMappings: { systems: systemsMap, ziplines: ziplinesMap, equipment: equipmentMap },
  };
}
