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
