import { useEffect, useState } from 'react';
import { subscribeVersionCheck, forceVersionCheck, getLastVersionResult, isVersionNewer, type VersionCheckResult } from '@/lib/version-check';
import { isPreviewOrIframeEnvironment } from '@/lib/environment';

export type Environment = 'preview' | 'published' | 'local';

export function getEnvironment(): Environment {
  if (typeof window === 'undefined') return 'local';
  const host = window.location.hostname;
  if (host.includes('id-preview--') || host.includes('lovableproject.com')) return 'preview';
  if (host.includes('lovable.app') || host.includes('rwreports.com')) return 'published';
  return 'local';
}

/**
 * Pinned production origin for resolving the deployed version when running
 * inside the Lovable preview. Preview is served from a different origin, so
 * a same-origin /version.json fetch returns the preview bundle's own version
 * (always one bump behind production). Polling the production custom domain
 * lets the preview badge show the same number users actually see live.
 */
const PREVIEW_DEPLOYED_PROBE_URL = 'https://rwreports.com/version.json';
const PREVIEW_POLL_INTERVAL_MS = 60 * 1000;
const PREVIEW_FETCH_TIMEOUT_MS = 5000;

async function fetchPreviewDeployedVersion(): Promise<string | null> {
  if (typeof fetch === 'undefined') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREVIEW_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${PREVIEW_DEPLOYED_PROBE_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.version === 'string' ? data.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Subscribes to the global version-check broadcaster and exposes
 * installed vs deployed + an "update available" flag for UI surfaces.
 *
 * In the Lovable preview environment, the deployed value is overridden
 * with a pinned fetch of rwreports.com/version.json so the badge shows
 * what production users actually have, not the preview bundle's own
 * (always-stale) version number.
 */
export function useVersionStatus(opts: { forceOnMount?: boolean } = {}) {
  const installed = (import.meta.env.APP_VERSION as string) || '0.0.0';
  const [result, setResult] = useState<VersionCheckResult | null>(getLastVersionResult());
  const [previewDeployed, setPreviewDeployed] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeVersionCheck(setResult);
    if (opts.forceOnMount) {
      void forceVersionCheck().catch(() => {});
    }
    return unsub;
  }, [opts.forceOnMount]);

  useEffect(() => {
    if (!isPreviewOrIframeEnvironment()) return;
    let cancelled = false;
    const run = async () => {
      const v = await fetchPreviewDeployedVersion();
      if (!cancelled && v) setPreviewDeployed(v);
    };
    void run();
    const id = setInterval(() => void run(), PREVIEW_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const deployed = previewDeployed ?? result?.deployed ?? null;
  const updateAvailable = !!deployed && isVersionNewer(installed, deployed, false);

  return {
    installed,
    deployed,
    updateAvailable,
    checkedAt: result?.checkedAt ?? null,
    environment: getEnvironment(),
  };
}
