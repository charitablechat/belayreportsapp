/**
 * Shared drift tolerance for "is this record actually unsynced?" decisions.
 *
 * Why a single constant: the same question ("is local newer than synced?") is
 * asked from at least three call sites — form load (`isLocalDataNewer`),
 * dashboard cache write (`shouldPreserveLocalRecord`), and the unsynced-counts
 * query in `offline-storage.ts`. When those answers disagree, you get phantom
 * "X pending" badges that never clear AND stale local copies overriding fresh
 * server payloads. Unifying on a single value eliminates both failure modes.
 *
 * Why 30 seconds (raised from 5s in S14): on slow mobile networks the gap
 * between local `updated_at = clientNow()` and the server-side `synced_at`
 * (set when the round-trip lands) routinely exceeded 5s, causing the
 * "sync keeps showing 1 pending" symptom — the record was re-flagged as dirty
 * immediately after a successful upload and re-uploaded next cycle. 30s
 * comfortably covers slow-3G round-trips, push-notification-deferred wakes,
 * and Postgres-trigger jitter. Real user edits virtually always produce drift
 * in the minute-plus range, so masking risk is negligible. Part B of S14 also
 * anchors local `updated_at` to the server response, so post-sync drift is
 * effectively zero — this 30s window only protects the brief observation gap.
 */
export const SYNC_DRIFT_TOLERANCE_MS = 30_000;

/**
 * Determines whether local (IndexedDB) data should take priority over server data.
 * Used by form pages to prevent stale server data from overwriting newer local edits.
 *
 * Server payload wins whenever the timestamps are within `SYNC_DRIFT_TOLERANCE_MS`
 * of each other AND the local copy has been synced at least once. This prevents the
 * "iPad keeps showing yesterday's local copy even after a fresh server fetch" failure.
 */
export function isLocalDataNewer(
  offlineData: { updated_at?: string | null; synced_at?: string | null } | null | undefined,
  serverData: { updated_at?: string | null } | null | undefined
): boolean {
  if (!offlineData) return false;
  if (!offlineData.synced_at) return true; // Never synced = local has unsynced changes

  if (!offlineData.updated_at || !serverData?.updated_at) return false;

  const localMs = new Date(offlineData.updated_at).getTime();
  const serverMs = new Date(serverData.updated_at).getTime();

  // Within tolerance — treat as the same logical version, prefer the server payload.
  if (Math.abs(localMs - serverMs) <= SYNC_DRIFT_TOLERANCE_MS) {
    return false;
  }

  // Local is meaningfully newer than the server.
  return localMs > serverMs;
}

/**
 * @deprecated Use {@link SYNC_DRIFT_TOLERANCE_MS} instead. Kept as an alias to
 * avoid breaking any importer that still references the old name.
 */
const CLOCK_SKEW_TOLERANCE_MS = SYNC_DRIFT_TOLERANCE_MS;

/**
 * Determines whether a local IndexedDB record should be preserved (not overwritten)
 * when the Dashboard caches server data locally. This prevents the destructive pattern
 * where server data with empty child records overwrites rich local data that hasn't synced yet.
 */
export function shouldPreserveLocalRecord(
  localRecord: { synced_at?: string | null; updated_at?: string | null } | null | undefined
): boolean {
  if (!localRecord) return false;
  // Never synced -- local data is the only copy
  if (!localRecord.synced_at) return true;
  // Local changes made after last sync (with clock-skew tolerance)
  if (localRecord.updated_at && localRecord.synced_at) {
    const drift = new Date(localRecord.updated_at).getTime() - new Date(localRecord.synced_at).getTime();
    if (drift > CLOCK_SKEW_TOLERANCE_MS) {
      return true;
    }
  }
  return false;
}
