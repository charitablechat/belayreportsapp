/**
 * Determines whether local (IndexedDB) data should take priority over server data.
 * Used by form pages to prevent stale server data from overwriting newer local edits.
 */
export function isLocalDataNewer(
  offlineData: { updated_at?: string | null; synced_at?: string | null } | null | undefined,
  serverData: { updated_at?: string | null } | null | undefined
): boolean {
  if (!offlineData) return false;
  if (!offlineData.synced_at) return true; // Never synced = local has unsynced changes
  return !!(
    offlineData.updated_at &&
    serverData?.updated_at &&
    new Date(offlineData.updated_at) > new Date(serverData.updated_at)
  );
}

/**
 * Clock-skew tolerance in milliseconds.
 * Client `updated_at` is set via `new Date()` while `synced_at` is set by
 * the server (`NOW()`). If the client clock is ahead by a few seconds the
 * record will appear "dirty" even though no real edits occurred. A 5-second
 * window absorbs typical mobile clock drift without masking genuine edits
 * (which produce gaps of many seconds or more).
 */
const CLOCK_SKEW_TOLERANCE_MS = 5000;

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
