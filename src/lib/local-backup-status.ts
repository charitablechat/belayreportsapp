/**
 * Local Data Recovery snapshot — read-only sync-status resolver.
 *
 * Purpose: the snapshot envelope stored in localStorage carries a `synced`
 * flag that reflects the report's sync state at the moment the envelope was
 * written. That flag goes stale quickly (the post-sync sweep in
 * `useAutoSync` only catches up after the next successful sync cycle), so
 * rendering it directly as "Unsynced" wrongly implies a server-sync failure.
 *
 * This module derives a more accurate display status by reading the
 * report's CURRENT local sync metadata (`updated_at` vs `synced_at`) from
 * IndexedDB. It is strictly read-only — no writes, no restores, no uploads,
 * no `markSnapshotSynced` calls. See `mem://architecture/restore-lock` and
 * `mem://features/local-first-data-integrity-v3`.
 *
 * Used by `LocalSnapshotsPanel` in `DataRecoveryTool.tsx` (which is shared
 * by both the admin Data Recovery route and the end-user
 * `UserDataRecoverySheet`, so the fix is cross-platform by construction).
 */

import {
  getOfflineInspection,
  getOfflineTraining,
  getOfflineDailyAssessment,
} from "@/lib/offline-storage";
import type { ReportType } from "@/lib/local-backup-ledger";

export type ResolvedSnapshotStatus =
  | "synced" // report in IDB and synced_at >= updated_at
  | "pending" // report in IDB and updated_at > synced_at (or synced_at missing)
  | "local_only" // report not found in IDB — envelope is the only on-device copy we can see
  | "unknown"; // IDB lookup threw / unavailable

export interface SnapshotStatusInput {
  reportType: ReportType;
  reportId: string;
}

/** Key used for the returned Map. Stable across renders for the same row. */
export function snapshotStatusKey(input: SnapshotStatusInput): string {
  return `${input.reportType}:${input.reportId}`;
}

function toMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Decide the displayed status for a single snapshot row from the report's
 * own sync metadata. Pure function — exported for unit tests.
 */
export function classifyFromReportRecord(
  record: Record<string, unknown> | null | undefined,
): ResolvedSnapshotStatus {
  if (!record) return "local_only";

  const updatedAt = toMs(record.updated_at);
  const syncedAt = toMs(record.synced_at);

  if (syncedAt == null) return "pending";
  if (updatedAt == null) {
    // We have a sync stamp but no update stamp — treat as synced
    // (record exists on the server, no known pending local edit).
    return "synced";
  }
  return syncedAt >= updatedAt ? "synced" : "pending";
}

async function readOne(
  input: SnapshotStatusInput,
): Promise<ResolvedSnapshotStatus> {
  try {
    let record: Record<string, unknown> | null | undefined = null;
    switch (input.reportType) {
      case "inspection":
        record = (await getOfflineInspection(input.reportId)) as
          | Record<string, unknown>
          | null
          | undefined;
        break;
      case "training":
        record = (await getOfflineTraining(input.reportId)) as
          | Record<string, unknown>
          | null
          | undefined;
        break;
      case "daily_assessment":
        record = (await getOfflineDailyAssessment(input.reportId)) as
          | Record<string, unknown>
          | null
          | undefined;
        break;
      default:
        return "unknown";
    }
    return classifyFromReportRecord(record);
  } catch {
    return "unknown";
  }
}

/**
 * Batch-resolve status for many snapshot rows. O(n) read-only IDB lookups,
 * issued in parallel. Acceptable for the expected snapshot counts (typically
 * well under a few hundred per device).
 */
export async function resolveSnapshotStatuses(
  inputs: ReadonlyArray<SnapshotStatusInput>,
): Promise<Map<string, ResolvedSnapshotStatus>> {
  const entries = await Promise.all(
    inputs.map(async (input) => {
      const status = await readOne(input);
      return [snapshotStatusKey(input), status] as const;
    }),
  );
  return new Map(entries);
}
