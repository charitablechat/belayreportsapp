/**
 * Pure-fetch module for InspectionForm data loading.
 *
 * IMPORTANT: This module does NOT touch React state, refs, or merge logic.
 * It returns raw data shapes; the caller (InspectionForm) owns all
 * coordination — `localIsNewer`, `isInternalUpdateRef`, `childDataLoadedRef`,
 * `mergeRecordFields` per-field merge, the 15s safety timeout, and the
 * normalize/merge helpers — because that logic is stateful and intentionally
 * lives in the page component.
 *
 * Slice 1 of the InspectionForm decomposition. Mirrors trainingLoader.ts.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  getOfflineInspection,
  getRelatedDataOffline,
  type DbRow,
} from "@/lib/offline-storage";
import { filterChildRows } from "@/lib/child-row-tombstones";

/**
 * Business-key derivation for operating-system rows. Must match the
 * derivation used at delete-time in OperatingSystemsTable so tombstones
 * filter unsynced temp-id rows correctly.
 *
 * Exported so InspectionForm load paths and tests share one definition
 * (cross-platform shared-path rule — every web/PWA/iPad/desktop/mobile
 * client routes through this single helper).
 */
export function osBusinessKey(
  row: { name?: unknown; system_name?: unknown } | null | undefined,
): string | null {
  const a = (row?.name ?? "").toString().trim().toLowerCase();
  const b = (row?.system_name ?? "").toString().trim().toLowerCase();
  const k = [a, b].filter(Boolean).join("|");
  return k || null;
}

/**
 * Apply the persistent operating-systems tombstone to a row array.
 *
 * Every InspectionForm load path (offline preload, server load,
 * server-empty/local-fallback, JSON-import reload) must route through
 * this helper so explicit user deletes of systems/dividers survive
 * browser restart and stale server refetches. The in-memory
 * `deletedSystemIdsRef` covers the live session; this covers the cold
 * reload. Same shape as `filterDeletedZiplines`.
 */
export function applySystemsTombstone<T extends { id?: string | null }>(
  inspectionId: string | null | undefined,
  rows: T[],
): T[] {
  if (!inspectionId || rows.length === 0) return rows;
  return filterChildRows(
    "inspection_operating_system",
    inspectionId,
    rows,
    osBusinessKey as (row: T) => string | null,
  );
}

// ---- STANDARDS_TEMPLATE + merge helpers (moved verbatim from page) -------

export const STANDARDS_TEMPLATE: Array<{
  standard_name: string;
  has_documentation: boolean | null;
}> = [
  { standard_name: "Local Written Operations Procedures", has_documentation: null },
  { standard_name: "Local Written Emergency Action Plan", has_documentation: null },
  { standard_name: "Minimum Annual Training", has_documentation: null },
  { standard_name: "Written Pre-Use Inspection in Use", has_documentation: null },
  { standard_name: "Inventory Tracking System in Use", has_documentation: null },
  { standard_name: "Operational Review Every 5 Years", has_documentation: null },
];

export const mergeStandards = (loaded: DbRow[]): DbRow[] => {
  return STANDARDS_TEMPLATE.map((template) => {
    const match = loaded.find((s) => s.standard_name === template.standard_name);
    return match || ({ ...template, id: crypto.randomUUID() } as DbRow);
  });
};

/**
 * Reload-time merge that prefers a locally-set has_documentation when the
 * loaded row is still null/undefined. Prevents an in-flight server fetch
 * (realtime/sync) from blanking a Yes/No checkbox the user just clicked.
 */
export const mergeStandardsPreserveLocal = (
  loaded: DbRow[],
  local: DbRow[],
): DbRow[] => {
  return STANDARDS_TEMPLATE.map((template) => {
    const loadedMatch = loaded.find((s) => s.standard_name === template.standard_name);
    const localMatch = local.find((s) => s.standard_name === template.standard_name);
    if (loadedMatch && localMatch) {
      const localHas = (localMatch as { has_documentation?: boolean | null }).has_documentation;
      const loadedHas = (loadedMatch as { has_documentation?: boolean | null }).has_documentation;
      if (
        (loadedHas === null || loadedHas === undefined) &&
        (localHas === true || localHas === false)
      ) {
        return { ...loadedMatch, has_documentation: localHas } as DbRow;
      }
      return loadedMatch as DbRow;
    }
    return (loadedMatch || localMatch || ({ ...template, id: crypto.randomUUID() } as DbRow)) as DbRow;
  });
};

// ---- Types ---------------------------------------------------------------

export interface OfflineInspectionPackage {
  inspection: DbRow | null;
  systems: DbRow[];
  ziplines: DbRow[];
  equipment: DbRow[];
  standards: DbRow[];
  summary: DbRow[]; // 0 or 1 entry
}

// ---- Loaders -------------------------------------------------------------

/**
 * Loads an inspection and all child rows from IndexedDB.
 * Never throws — boundary errors surface as null / empty arrays from the
 * underlying offline-storage helpers.
 */
export async function loadInspectionFromOffline(
  id: string,
): Promise<OfflineInspectionPackage> {
  const offlineInspection = await getOfflineInspection(id);
  const [systems, ziplines, equipment, standards, summary] = await Promise.all([
    getRelatedDataOffline("systems", id),
    getRelatedDataOffline("ziplines", id),
    getRelatedDataOffline("equipment", id),
    getRelatedDataOffline("standards", id),
    getRelatedDataOffline("summary", id),
  ]);

  return {
    inspection: offlineInspection ?? null,
    systems: filterChildRows(
      "inspection_operating_system",
      id,
      systems || [],
      osBusinessKey,
    ),
    ziplines: ziplines || [],
    equipment: equipment || [],
    standards: standards || [],
    summary: summary || [],
  };
}

/**
 * Fetches just the parent inspection row from Supabase (with inspector profile).
 * Returns the error separately so the caller can detect "inconclusive lookup"
 * without swallowing it.
 */
export async function fetchInspectionParentFromServer(id: string) {
  const { data, error } = await supabase
    .from("inspections")
    .select(
      "*, inspector:profiles!inspections_inspector_id_profiles_fkey(first_name, last_name, avatar_url)",
    )
    .eq("id", id)
    .maybeSingle();
  return { inspection: (data as DbRow | null) ?? null, error };
}

/**
 * Fetches all child rows for an inspection in parallel.
 */
export async function fetchInspectionChildrenFromServer(id: string) {
  const [
    { data: systemsData },
    { data: ziplinesData },
    { data: equipmentData },
    { data: standardsData },
    { data: summaryData },
  ] = await Promise.all([
    supabase
      .from("inspection_systems")
      .select("*")
      .eq("inspection_id", id)
      .order("display_order"),
    supabase
      .from("inspection_ziplines")
      .select("*")
      .eq("inspection_id", id)
      .order("display_order"),
    supabase
      .from("inspection_equipment")
      .select("*")
      .eq("inspection_id", id)
      .order("display_order"),
    supabase.from("inspection_standards").select("*").eq("inspection_id", id),
    supabase
      .from("inspection_summary")
      .select("*")
      .eq("inspection_id", id)
      .maybeSingle(),
  ]);

  return {
    systems: filterChildRows(
      "inspection_operating_system",
      id,
      (systemsData as DbRow[]) || [],
      osBusinessKey,
    ),
    ziplines: (ziplinesData as DbRow[]) || [],
    equipment: (equipmentData as DbRow[]) || [],
    standards: (standardsData as DbRow[]) || [],
    summary: (summaryData as DbRow | null) ?? null,
  };
}
