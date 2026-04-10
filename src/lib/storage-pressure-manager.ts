/**
 * Storage Pressure Manager — Tiered Eviction System
 * 
 * Monitors IndexedDB usage via `navigator.storage.estimate()` and triggers
 * graduated cleanup actions to prevent storage exhaustion.
 * 
 * Safety: NEVER evicts unsynced data. Only removes records confirmed synced to server.
 * Data lives on the server and is re-fetched on demand when the user opens a report.
 */

export type StorageTier = 0 | 1 | 2 | 3;

export interface StorageEstimate {
  usageBytes: number;
  quotaBytes: number;
  usagePercent: number;
  tier: StorageTier;
}

// Tier thresholds
const TIER_1_THRESHOLD = 0.60; // 60%
const TIER_2_THRESHOLD = 0.80; // 80%
const TIER_3_THRESHOLD = 0.90; // 90%

// Eviction age thresholds (in days)
const TIER_1_AGE_DAYS = 30;
const TIER_2_AGE_DAYS = 7;
const TIER_3_AGE_DAYS = 1;

// Version caps per tier
const TIER_2_MAX_VERSIONS = 3;
const TIER_3_MAX_VERSIONS = 1;

// Cooldown: don't run eviction more than once per 5 minutes
let lastEvictionRun = 0;
const EVICTION_COOLDOWN = 5 * 60 * 1000;

/**
 * Get current storage estimate and tier classification
 */
export async function getStorageEstimate(): Promise<StorageEstimate> {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const usageBytes = estimate.usage || 0;
      const quotaBytes = estimate.quota || 0;
      const usagePercent = quotaBytes > 0 ? usageBytes / quotaBytes : 0;

      let tier: StorageTier = 0;
      if (usagePercent >= TIER_3_THRESHOLD) tier = 3;
      else if (usagePercent >= TIER_2_THRESHOLD) tier = 2;
      else if (usagePercent >= TIER_1_THRESHOLD) tier = 1;

      return { usageBytes, quotaBytes, usagePercent, tier };
    }
  } catch {
    // Storage API unavailable
  }

  // Fallback: assume healthy
  return { usageBytes: 0, quotaBytes: 0, usagePercent: 0, tier: 0 };
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Main entry point — called after each sync cycle.
 * Checks storage pressure and triggers appropriate eviction tier.
 */
export async function manageStoragePressure(): Promise<{
  tier: StorageTier;
  evictedReports: number;
  evictedBackups: number;
  prunedVersions: number;
}> {
  const result = { tier: 0 as StorageTier, evictedReports: 0, evictedBackups: 0, prunedVersions: 0 };

  // Cooldown check
  const now = Date.now();
  if (now - lastEvictionRun < EVICTION_COOLDOWN) {
    return result;
  }

  try {
    const estimate = await getStorageEstimate();
    result.tier = estimate.tier;

    if (estimate.tier === 0) {
      // Still run backup cleanup unconditionally (cheap, 14-day threshold)
      const { evictOldReportBackups } = await import('./offline-storage');
      result.evictedBackups = await evictOldReportBackups(14);
      return result;
    }

    lastEvictionRun = now;

    if (import.meta.env.DEV) {
      console.log(
        `[StoragePressure] Tier ${estimate.tier} — ${formatBytes(estimate.usageBytes)} / ${formatBytes(estimate.quotaBytes)} (${(estimate.usagePercent * 100).toFixed(1)}%)`
      );
    }

    const { evictSyncedReports, evictOldReportBackups, evictSyncedPhotoMetadata } = await import('./offline-storage');

    // Always clean old backups
    result.evictedBackups = await evictOldReportBackups(14);

    // Tier-specific eviction
    let ageDays: number;
    let maxVersions: number | undefined;

    switch (estimate.tier) {
      case 1:
        ageDays = TIER_1_AGE_DAYS;
        break;
      case 2:
        ageDays = TIER_2_AGE_DAYS;
        maxVersions = TIER_2_MAX_VERSIONS;
        break;
      case 3:
        ageDays = TIER_3_AGE_DAYS;
        maxVersions = TIER_3_MAX_VERSIONS;
        break;
      default:
        return result;
    }

    // Evict synced reports older than threshold
    result.evictedReports = await evictSyncedReports(ageDays);

    // Evict orphaned photo metadata (blob already null, synced)
    await evictSyncedPhotoMetadata(ageDays);

    // Prune version history if tier >= 2
    if (maxVersions !== undefined) {
      const { pruneAllVersionsToMax } = await import('./report-version-manager');
      result.prunedVersions = await pruneAllVersionsToMax(maxVersions);
    }

    if (import.meta.env.DEV) {
      console.log(
        `[StoragePressure] Evicted ${result.evictedReports} reports, ${result.evictedBackups} backups, pruned ${result.prunedVersions} versions`
      );
    }
  } catch (error) {
    console.warn('[StoragePressure] Eviction cycle failed:', error);
  }

  return result;
}
