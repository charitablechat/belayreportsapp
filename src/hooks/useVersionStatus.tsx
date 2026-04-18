import { useEffect, useState } from 'react';
import { subscribeVersionCheck, forceVersionCheck, getLastVersionResult, isVersionNewer, type VersionCheckResult } from '@/lib/version-check';

export type Environment = 'preview' | 'published' | 'local';

export function getEnvironment(): Environment {
  if (typeof window === 'undefined') return 'local';
  const host = window.location.hostname;
  if (host.includes('id-preview--') || host.includes('lovableproject.com')) return 'preview';
  if (host.includes('lovable.app') || host.includes('rwreports.com')) return 'published';
  return 'local';
}

/**
 * Subscribes to the global version-check broadcaster and exposes
 * installed vs deployed + an "update available" flag for UI surfaces.
 */
export function useVersionStatus(opts: { forceOnMount?: boolean } = {}) {
  const installed = (import.meta.env.APP_VERSION as string) || '0.0.0';
  const [result, setResult] = useState<VersionCheckResult | null>(getLastVersionResult());

  useEffect(() => {
    const unsub = subscribeVersionCheck(setResult);
    if (opts.forceOnMount) {
      void forceVersionCheck().catch(() => {});
    }
    return unsub;
  }, [opts.forceOnMount]);

  const deployed = result?.deployed ?? null;
  const updateAvailable = !!deployed && isVersionNewer(installed, deployed, false);

  return {
    installed,
    deployed,
    updateAvailable,
    checkedAt: result?.checkedAt ?? null,
    environment: getEnvironment(),
  };
}
