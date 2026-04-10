import { useState, useEffect, useCallback } from 'react';
import { getStorageEstimate, formatBytes, type StorageEstimate, type StorageTier } from '@/lib/storage-pressure-manager';

/**
 * Hook to monitor storage usage. Polls every 60 seconds.
 */
export function useStoragePressure(enabled: boolean = true) {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);

  const refresh = useCallback(async () => {
    const est = await getStorageEstimate();
    setEstimate(est);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const interval = setInterval(refresh, 60000);
    return () => clearInterval(interval);
  }, [enabled, refresh]);

  return {
    estimate,
    refresh,
    tierLabel: estimate ? getTierLabel(estimate.tier) : null,
    tierColor: estimate ? getTierColor(estimate.tier) : null,
    formattedUsage: estimate ? formatBytes(estimate.usageBytes) : null,
    formattedQuota: estimate ? formatBytes(estimate.quotaBytes) : null,
  };
}

function getTierLabel(tier: StorageTier): string {
  switch (tier) {
    case 0: return 'Healthy';
    case 1: return 'Moderate';
    case 2: return 'High';
    case 3: return 'Critical';
  }
}

function getTierColor(tier: StorageTier): string {
  switch (tier) {
    case 0: return 'text-green-600 dark:text-green-400';
    case 1: return 'text-amber-600 dark:text-amber-400';
    case 2: return 'text-orange-600 dark:text-orange-400';
    case 3: return 'text-destructive';
  }
}
