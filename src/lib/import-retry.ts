/**
 * import-retry.ts
 *
 * Helpers for caching and retrying failed child-data inserts that occur
 * during inspection import (NewInspection → insertChildData).
 *
 * Storage uses safeSetItem / safeRemoveItem (project convention, ESLint-enforced).
 * No platform branches — localStorage is available on web, installed PWA, and iPad.
 */

import { safeSetItem, safeRemoveItem } from "@/lib/safe-local-storage";
import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChildTable =
  | "inspection_systems"
  | "inspection_equipment"
  | "inspection_ziplines"
  | "inspection_standards"
  | "inspection_summary";

export interface FailedImportPayload {
  inspectionId: string;
  savedAt: string;
  tables: Partial<Record<ChildTable, Record<string, unknown>[]>>;
}

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

export const IMPORT_RETRY_KEY_PREFIX = "import-retry:inspection:";

function storageKey(inspectionId: string): string {
  return `${IMPORT_RETRY_KEY_PREFIX}${inspectionId}`;
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Persist a failed import payload to localStorage so the user can retry later.
 * Uses safeSetItem — never throws.
 */
export function saveFailedImportPayload(payload: FailedImportPayload): void {
  safeSetItem(storageKey(payload.inspectionId), JSON.stringify(payload), {
    scope: "import-retry.save",
  });
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Load a previously cached failed import payload for the given inspection ID.
 * Returns null if no entry exists or if the stored JSON is malformed.
 */
export function loadFailedImportPayload(
  inspectionId: string
): FailedImportPayload | null {
  try {
    const raw = localStorage.getItem(storageKey(inspectionId));
    if (!raw) return null;
    return JSON.parse(raw) as FailedImportPayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

/**
 * Remove the cached failed import payload for the given inspection ID.
 * Uses safeRemoveItem — never throws.
 */
export function clearFailedImportPayload(inspectionId: string): void {
  safeRemoveItem(storageKey(inspectionId));
}

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

/**
 * Attempt to re-insert the cached rows for each failed table.
 *
 * - On full success: clears the cache entry and returns { failed: [], succeeded: [...] }.
 * - On partial success: rewrites the cache with only the still-failing tables.
 * - On full failure: cache is unchanged.
 */
export async function retryFailedImport(
  inspectionId: string
): Promise<{ failed: ChildTable[]; succeeded: ChildTable[] }> {
  const payload = loadFailedImportPayload(inspectionId);
  if (!payload) return { failed: [], succeeded: [] };

  const tablesToRetry = Object.entries(payload.tables) as [
    ChildTable,
    Record<string, unknown>[]
  ][];

  const results = await Promise.allSettled(
    tablesToRetry.map(([table, rows]) =>
      supabase
        .from(table)
        .insert(rows)
        .then(({ error }) => {
          if (error) throw error;
        })
    )
  );

  const failed: ChildTable[] = [];
  const succeeded: ChildTable[] = [];
  const remainingPayload: Partial<Record<ChildTable, Record<string, unknown>[]>> = {};

  results.forEach((result, i) => {
    const [table, rows] = tablesToRetry[i];
    if (result.status === "rejected") {
      failed.push(table);
      remainingPayload[table] = rows;
      console.error(
        `[import-retry] Retry failed for ${table}:`,
        (result as PromiseRejectedResult).reason?.message ||
          (result as PromiseRejectedResult).reason
      );
    } else {
      succeeded.push(table);
      console.log(`[import-retry] Retry succeeded for ${table}`);
    }
  });

  if (failed.length === 0) {
    clearFailedImportPayload(inspectionId);
    console.log("[import-retry] All retries succeeded — cache cleared");
  } else {
    // Rewrite cache with only the tables that still failed
    saveFailedImportPayload({
      inspectionId,
      savedAt: new Date().toISOString(),
      tables: remainingPayload,
    });
  }

  return { failed, succeeded };
}
