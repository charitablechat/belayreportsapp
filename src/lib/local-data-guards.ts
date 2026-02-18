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
  // Local changes made after last sync
  if (localRecord.updated_at && localRecord.synced_at &&
      new Date(localRecord.updated_at) > new Date(localRecord.synced_at)) {
    return true;
  }
  return false;
}
