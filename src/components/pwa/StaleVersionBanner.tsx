import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { subscribeVersionCheck, type VersionCheckResult } from '@/lib/version-check';
import { isPreviewOrIframeEnvironment } from '@/lib/environment';

/**
 * Soft refresh banner. Appears when /version.json reports a newer deployed
 * version than the running build AND the regular SW update flow hasn't
 * already surfaced an update. Catches the silent-SW-failure edge cases
 * (iOS Safari cache, corp proxies, flaky CDNs).
 *
 * On iOS standalone (Add-to-Home-Screen PWA), the Refresh button also
 * clears all caches before reloading — necessary because iOS standalone
 * mode boots from app-shell cache and can serve stale JS even after a
 * SW update.
 */
export const StaleVersionBanner = () => {
  const [result, setResult] = useState<VersionCheckResult | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (isPreviewOrIframeEnvironment()) return;
    const unsub = subscribeVersionCheck((r) => setResult(r));
    return unsub;
  }, []);

  if (!result?.isStale || dismissed) return null;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Detect iOS standalone PWA — needs aggressive cache clearing
      const isIOSStandalone =
        typeof navigator !== 'undefined' &&
        // @ts-ignore - non-standard but present on iOS Safari
        (navigator.standalone === true ||
          window.matchMedia('(display-mode: standalone)').matches);

      if (isIOSStandalone && typeof caches !== 'undefined') {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        } catch {
          // ignore — fall through to reload
        }
      }
    } finally {
      // Force a network revalidation reload
      window.location.reload();
    }
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9998] max-w-md w-[calc(100%-2rem)] bg-card border border-border shadow-lg rounded-lg px-4 py-3 flex items-center gap-3 font-mono text-sm">
      <RefreshCw className={`w-4 h-4 text-primary shrink-0 ${refreshing ? 'animate-spin' : ''}`} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-foreground">New version available</div>
        <div className="text-xs text-muted-foreground truncate">
          v{result.current} → v{result.deployed} — refresh to update
        </div>
      </div>
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        className="bg-primary text-primary-foreground px-3 py-1.5 rounded text-xs font-bold tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-60"
      >
        {refreshing ? '…' : 'REFRESH'}
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
