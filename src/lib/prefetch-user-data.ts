/**
 * Pre-warm user-scoped data into IndexedDB (Phase 2 D).
 *
 * Additive layer: uses existing fetchers / IDB savers. Runs once per
 * session on successful online sign-in and after each successful sync.
 *
 * Scope (bounded):
 *   - Dashboard lists for inspections / trainings / daily assessments
 *     (last 90 days).
 *   - Profile metadata.
 *   - Does NOT pre-fetch every child row of every report — that happens
 *     lazily on demand when the report is opened. Open/recent reports
 *     are already kept fresh by the existing IDB-first loaders + sync.
 */

import { supabase } from "@/integrations/supabase/client";
import { saveInspectionOffline } from "@/lib/offline-storage";

const SESSION_FLAG = "prefetch-user-data.fired";
const RESULT_KEY = "prefetch-user-data.results";

export interface PrefetchResults {
  inspections: number;
  trainings: number;
  dailyAssessments: number;
  profile: boolean;
  failed: string[];
  ranAt: number;
}

function writeResults(r: PrefetchResults) {
  try {
    sessionStorage.setItem(RESULT_KEY, JSON.stringify(r));
  } catch {
    // ignore
  }
}

export function getPrefetchResults(): PrefetchResults | null {
  try {
    const raw = sessionStorage.getItem(RESULT_KEY);
    return raw ? (JSON.parse(raw) as PrefetchResults) : null;
  } catch {
    return null;
  }
}

export async function prefetchAllUserData(
  opts: { userId?: string; force?: boolean } = {},
): Promise<PrefetchResults> {
  const results: PrefetchResults = {
    inspections: 0,
    trainings: 0,
    dailyAssessments: 0,
    profile: false,
    failed: [],
    ranAt: Date.now(),
  };

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    results.failed.push("offline");
    writeResults(results);
    return results;
  }

  if (!opts.force) {
    try {
      if (sessionStorage.getItem(SESSION_FLAG) === "1") {
        return getPrefetchResults() || results;
      }
    } catch {
      // ignore
    }
  }

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Inspections
  try {
    const { data, error } = await supabase
      .from("inspections")
      .select(
        "id, inspector_id, organization, location, inspection_date, status, created_at, updated_at, synced_at, last_opened_at, acct_number, started_at, latest_report_generated_at, report_version, deleted_at, organization_id",
      )
      .is("deleted_at", null)
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    if (data) {
      results.inspections = data.length;
      await Promise.all(
        data.map((row) =>
          saveInspectionOffline(row as never, {
            markDirty: false,
            explicitUserSave: false,
            dispatchSyncEvent: false,
          }).catch(() => undefined),
        ),
      );
    }
  } catch (e) {
    results.failed.push(`inspections:${(e as Error)?.message || "err"}`);
  }

  // Trainings — list-only mirror via direct fetch; existing IDB save helpers
  // for child rows are used lazily when the report is opened.
  try {
    const { data, error } = await supabase
      .from("trainings")
      .select(
        "id, inspector_id, organization, trainer_of_record, start_date, end_date, status, created_at, updated_at, synced_at, latest_report_generated_at, report_version, deleted_at",
      )
      .is("deleted_at", null)
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    results.trainings = data?.length ?? 0;
  } catch (e) {
    results.failed.push(`trainings:${(e as Error)?.message || "err"}`);
  }

  // Daily assessments
  try {
    const { data, error } = await supabase
      .from("daily_assessments")
      .select(
        "id, inspector_id, organization, site, trainer_of_record, assessment_date, status, created_at, updated_at, synced_at, latest_report_generated_at, report_version, deleted_at",
      )
      .is("deleted_at", null)
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    results.dailyAssessments = data?.length ?? 0;
  } catch (e) {
    results.failed.push(`daily_assessments:${(e as Error)?.message || "err"}`);
  }

  // Profile
  try {
    if (opts.userId) {
      const { error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", opts.userId)
        .maybeSingle();
      if (!error) results.profile = true;
    }
  } catch (e) {
    results.failed.push(`profile:${(e as Error)?.message || "err"}`);
  }

  try {
    sessionStorage.setItem(SESSION_FLAG, "1");
  } catch {
    // ignore
  }
  writeResults(results);
  return results;
}
