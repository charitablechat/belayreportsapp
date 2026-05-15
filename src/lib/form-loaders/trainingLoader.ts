/**
 * Pure-fetch module for TrainingForm data loading.
 *
 * IMPORTANT: This module does NOT touch React state, refs, or merge logic.
 * It returns raw data shapes; the caller (TrainingForm) owns all
 * coordination — `localIsNewer`, `isInternalUpdateRef`, `childDataLoadedRef`,
 * and `mergeRecordFields` per-field merge — because that logic is stateful
 * and intentionally lives in the page component.
 *
 * Slice 1 of the TrainingForm decomposition.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  getOfflineTraining,
  getTrainingDataOffline,
  type DbRow,
} from "@/lib/offline-storage";

export interface OfflineTrainingPackage {
  training: DbRow | null;
  delivery_approaches: DbRow[];
  operating_systems: DbRow[];
  immediate_attention: DbRow[];
  verifiable_items: DbRow[];
  systems_in_place: DbRow[];
  summary: DbRow | undefined;
}

export interface ServerTrainingPackage {
  training: DbRow | null;
  trainingError: unknown;
  delivery_approaches: DbRow[];
  operating_systems: DbRow[];
  immediate_attention: DbRow[];
  verifiable_items: DbRow[];
  systems_in_place: DbRow[];
  summary: DbRow | null;
}

/**
 * Loads a training and all child rows from IndexedDB.
 * Never throws — boundary errors surface as empty arrays / null.
 */
export async function loadTrainingFromOffline(
  id: string
): Promise<OfflineTrainingPackage> {
  const offlineTraining = await getOfflineTraining(id);
  const [
    delivery_approaches,
    operating_systems,
    immediate_attention,
    verifiable_items,
    systems_in_place,
    summaryArr,
  ] = await Promise.all([
    getTrainingDataOffline("delivery_approaches", id),
    getTrainingDataOffline("operating_systems", id),
    getTrainingDataOffline("immediate_attention", id),
    getTrainingDataOffline("verifiable_items", id),
    getTrainingDataOffline("systems_in_place", id),
    getTrainingDataOffline("summary", id),
  ]);

  return {
    training: offlineTraining ?? null,
    delivery_approaches: delivery_approaches || [],
    operating_systems: operating_systems || [],
    immediate_attention: immediate_attention || [],
    verifiable_items: verifiable_items || [],
    systems_in_place: systems_in_place || [],
    summary: summaryArr?.[0],
  };
}

/**
 * Fetches a training and all child rows from Supabase.
 * Returns the parent error separately so the caller can branch on
 * "inconclusive lookup" without swallowing it.
 */
/**
 * Fetches just the parent training row from Supabase.
 * Returns the error separately so the caller can detect "inconclusive
 * lookup" without swallowing it.
 */
export async function fetchTrainingParentFromServer(id: string) {
  const { data, error } = await supabase
    .from("trainings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return { training: (data as DbRow | null) ?? null, error };
}

/**
 * Fetches all child rows for a training in parallel.
 */
export async function fetchTrainingChildrenFromServer(id: string) {
  const [
    { data: approachData },
    { data: systemData },
    { data: attentionData },
    { data: verifiableData },
    { data: systemsPlaceData },
    { data: summaryResult },
  ] = await Promise.all([
    supabase.from("training_delivery_approaches").select("*").eq("training_id", id).order("created_at"),
    supabase.from("training_operating_systems").select("*").eq("training_id", id).order("created_at"),
    supabase.from("training_immediate_attention").select("*").eq("training_id", id).order("created_at"),
    supabase.from("training_verifiable_items").select("*").eq("training_id", id).order("created_at"),
    supabase.from("training_systems_in_place").select("*").eq("training_id", id).order("created_at"),
    supabase.from("training_summary").select("*").eq("training_id", id).maybeSingle(),
  ]);

  return {
    delivery_approaches: (approachData as DbRow[]) || [],
    operating_systems: (systemData as DbRow[]) || [],
    immediate_attention: (attentionData as DbRow[]) || [],
    verifiable_items: (verifiableData as DbRow[]) || [],
    systems_in_place: (systemsPlaceData as DbRow[]) || [],
    summary: (summaryResult as DbRow | null) ?? null,
  };
}

/**
 * Convenience: parent + children in one shot.
 * Use only when caller wants both unconditionally.
 */
export async function fetchTrainingFromServer(
  id: string
): Promise<ServerTrainingPackage> {
  const { training, error } = await fetchTrainingParentFromServer(id);
  if (!training) {
    return {
      training: null,
      trainingError: error,
      delivery_approaches: [],
      operating_systems: [],
      immediate_attention: [],
      verifiable_items: [],
      systems_in_place: [],
      summary: null,
    };
  }
  const children = await fetchTrainingChildrenFromServer(id);
  return { training, trainingError: null, ...children };
}
