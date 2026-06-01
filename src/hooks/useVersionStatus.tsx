import { useEffect, useState } from 'react';
import { subscribeVersionCheck, forceVersionCheck, getLastVersionResult, isVersionNewer, type VersionCheckResult } from '@/lib/version-check';
import { isPreviewOrIframeEnvironment } from '@/lib/environment';
import { supabase } from '@/integrations/supabase/client';

export type Environment = 'preview' | 'published' | 'local';

export function getEnvironment(): Environment {
  if (typeof window === 'undefined') return 'local';
  const host = window.location.hostname;
  if (host.includes('id-preview--') || host.includes('lovableproject.com')) return 'preview';
  if (host.includes('lovable.app') || host.includes('rwreports.com')) return 'published';
  return 'local';
}

/**
 * In the Lovable preview we can't fetch rwreports.com/version.json directly
 * because the production origin doesn't send CORS headers. Route through a
 * tiny edge-function proxy (get-deployed-version) which fetches server-side
 * and re-emits with permissive CORS. Soft-fails to null on any error so the
 * badge silently falls back to showing the local APP_VERSION.
 */
const PREVIEW_POLL_INTERVAL_MS = 60 * 1000;

async function fetchPreviewDeployedVersion(): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('get-deployed-version');
    if (error) return null;
    const v = (data as { version?: unknown } | null)?.version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
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
