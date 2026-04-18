/**
 * Enforces a minimum required app version set by super admin.
 * - Soft mode: persistent, non-dismissable banner at top.
 * - Hard mode: full-screen blocking modal with Refresh button.
 *
 * Respects unsynced data — recommends syncing before reload.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { subscribeVersionPolicy, isBelowMinimum, type VersionPolicy } from '@/lib/version-policy';
import { APP_VERSION } from '@/lib/attestation';
import { usePWA } from '@/hooks/usePWA';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

async function clearCachesAndReload() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch {
    // ignore
  } finally {
    window.location.reload();
  }
}

export function MinVersionEnforcer() {
  const [policy, setPolicy] = useState<VersionPolicy | null>(null);
  const { unsyncedCount, forceSync, isSyncing } = usePWA();

  useEffect(() => {
    return subscribeVersionPolicy(setPolicy);
  }, []);

  if (!policy) return null;
  if (!isBelowMinimum(policy)) return null;

  const handleSyncFirst = async () => {
    toast.loading('Syncing data...', { id: 'min-version-sync' });
    try {
      await forceSync();
      toast.dismiss('min-version-sync');
      toast.success('Sync complete — refreshing...');
      setTimeout(() => clearCachesAndReload(), 600);
    } catch {
      toast.dismiss('min-version-sync');
      toast.error('Sync failed — refresh anyway?');
    }
  };

  const handleReload = () => {
    if (unsyncedCount > 0) {
      void handleSyncFirst();
    } else {
      void clearCachesAndReload();
    }
  };

  const message = policy.message || 'This version is no longer supported. Please refresh to continue.';

  // HARD MODE: full-screen blocking modal
  if (policy.enforce_hard_reload) {
    return (
      <div className="fixed inset-0 z-[9999] bg-background/95 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-card border border-border rounded-lg shadow-lg p-6 space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-destructive shrink-0" />
            <h2 className="text-lg font-semibold text-foreground">Update Required</h2>
          </div>
          <p className="text-sm text-muted-foreground">{message}</p>
          <div className="text-xs text-muted-foreground space-y-1 border-t border-border pt-3">
            <p>Your version: <span className="font-mono text-foreground">v{APP_VERSION}</span></p>
            <p>Required: <span className="font-mono text-foreground">v{policy.min_required_version}</span></p>
            {unsyncedCount > 0 && (
              <p className="text-amber-500 dark:text-amber-400 mt-2">
                {unsyncedCount} unsynced report{unsyncedCount !== 1 ? 's' : ''} will be saved before reload.
              </p>
            )}
          </div>
          <Button onClick={handleReload} disabled={isSyncing} className="w-full">
            <RefreshCw className={`w-4 h-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing...' : unsyncedCount > 0 ? 'Sync & Refresh' : 'Refresh Now'}
          </Button>
        </div>
      </div>
    );
  }

  // SOFT MODE: top banner, non-dismissable
  return (
    <div className="fixed top-0 left-0 right-0 z-[9998] bg-amber-500 text-amber-950 px-4 py-2 shadow-md">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{message}</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleReload}
          disabled={isSyncing}
          className="bg-amber-950 text-amber-50 border-amber-950 hover:bg-amber-900 hover:text-amber-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isSyncing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
    </div>
  );
}
