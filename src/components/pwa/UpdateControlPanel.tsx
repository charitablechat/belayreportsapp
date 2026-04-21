import { useEffect, useState } from 'react';
import { RefreshCw, Download, Trash2, AlertTriangle, CheckCircle2, ArrowUpCircle } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { usePWA } from '@/hooks/usePWA';
import { triggerHaptic } from '@/lib/haptics';
import { toast } from 'sonner';
import {
  forceVersionCheck,
  subscribeVersionCheck,
  isVersionNewer,
  type VersionCheckResult,
} from '@/lib/version-check';

interface UpdateControlPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const UPDATE_FLAG_KEY = 'pwa-update-pending';
const IN_PANEL_REFRESH_MS = 15_000;

export const UpdateControlPanel = ({ open, onOpenChange }: UpdateControlPanelProps) => {
  const {
    needsUpdate,
    updateAndReload,
    unsyncedCount,
    forceSync,
    isSyncing,
    isCheckingForUpdate,
    checkForUpdates,
  } = usePWA();

  const [showForceRefreshDialog, setShowForceRefreshDialog] = useState(false);
  const [showUnsyncedWarning, setShowUnsyncedWarning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [versionResult, setVersionResult] = useState<VersionCheckResult | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const appVersion = import.meta.env.APP_VERSION || 'dev';
  const appBuild = (import.meta.env.BUILD_COMMIT as string) || '';

  // Subscribe to version-check broadcasts so panel stays live
  useEffect(() => {
    return subscribeVersionCheck(setVersionResult);
  }, []);

  // On open: immediately poll + nudge SW. While open: re-poll every 15s.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const runCheck = async () => {
      setIsPolling(true);
      try {
        await Promise.all([
          forceVersionCheck(),
          checkForUpdates().catch(() => {}),
        ]);
      } finally {
        if (!cancelled) setIsPolling(false);
      }
    };

    void runCheck();
    const interval = setInterval(() => {
      void forceVersionCheck();
    }, IN_PANEL_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open, checkForUpdates]);

  const deployedVersion = versionResult?.deployed || null;
  const deployedNewer = deployedVersion
    ? isVersionNewer(appVersion, deployedVersion, false)
    : false;
  const deployedDiffers = deployedVersion && deployedVersion !== appVersion;
  const updateAvailable = needsUpdate || deployedNewer;

  const statusLabel = applying
    ? 'APPLYING...'
    : isPolling || isCheckingForUpdate
    ? 'CHECKING...'
    : updateAvailable
    ? 'UPDATE AVAILABLE'
    : 'UP TO DATE';

  const statusColor = applying
    ? 'text-orange-400 border-orange-400/40'
    : isPolling || isCheckingForUpdate
    ? 'text-blue-400 border-blue-400/40'
    : updateAvailable
    ? 'text-amber-400 border-amber-400/40'
    : 'text-green-400 border-green-400/40';

  const formatTime = (date: Date | null | undefined) => {
    if (!date) return '--:--:--';
    return date.toLocaleTimeString('en-US', { hour12: false });
  };

  const handleCheckNow = async () => {
    triggerHaptic('light');
    setIsPolling(true);
    try {
      await Promise.all([
        forceVersionCheck(),
        checkForUpdates().catch(() => {}),
      ]);
    } finally {
      setIsPolling(false);
    }
  };

  const handleApplyUpdate = async () => {
    if (unsyncedCount > 0) {
      setShowUnsyncedWarning(true);
      return;
    }
    applyUpdate();
  };

  const applyUpdate = () => {
    setApplying(true);
    localStorage.setItem(UPDATE_FLAG_KEY, 'true');
    triggerHaptic('success');
    if (needsUpdate) {
      updateAndReload();
    } else {
      // SW says we're current but version.json says otherwise — clear caches and reload
      void clearCachesAndReload();
    }
  };

  const clearCachesAndReload = async () => {
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
  };

  const handleSyncFirst = async () => {
    setShowUnsyncedWarning(false);
    toast.loading('Syncing data...', { id: 'sync-before-update' });
    try {
      await forceSync();
      toast.dismiss('sync-before-update');
      toast.success('Sync complete!');
      triggerHaptic('success');
    } catch {
      toast.dismiss('sync-before-update');
      toast.error('Sync failed');
      triggerHaptic('warning');
    }
  };

  const handleForceRefreshRequest = () => {
    if (unsyncedCount > 0) {
      setShowUnsyncedWarning(true);
    } else {
      setShowForceRefreshDialog(true);
    }
  };

  const handleForceRefresh = async () => {
    setShowForceRefreshDialog(false);
    toast.loading('Clearing cache...', { id: 'force-refresh' });
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(reg => reg.unregister()));
      }
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }
      toast.dismiss('force-refresh');
      toast.success('Cache cleared! Reloading...');
      triggerHaptic('success');
      setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      console.error('[Force Refresh] Error:', error);
      toast.dismiss('force-refresh');
      toast.error('Failed to clear cache');
      triggerHaptic('warning');
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-[340px] sm:w-[380px] p-0 border-l border-white/20 bg-black/95 backdrop-blur-xl overflow-hidden"
        >
          <div
            className="pointer-events-none absolute inset-0 z-10"
            style={{
              background:
                'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.015) 2px, rgba(255,255,255,0.015) 4px)',
            }}
          />

          <div className="relative z-20 flex flex-col h-full font-mono text-white/90">
            <SheetHeader className="px-5 pt-6 pb-4 border-b border-white/10">
              <SheetTitle className="font-mono text-white/90 text-sm tracking-widest uppercase">
                System Update
              </SheetTitle>
            </SheetHeader>

            <div className="flex-1 px-5 py-5 space-y-6 overflow-y-auto">
              {/* Installed version */}
              <div>
                <span className="text-[10px] text-white/40 uppercase tracking-widest">Installed</span>
                <p className="text-lg mt-1 text-white tracking-wider">v{appVersion}</p>
                {appBuild && (
                  <p className="text-[10px] text-white/30 tracking-widest mt-0.5">build {appBuild}</p>
                )}
              </div>

              {/* Deployed version (live) */}
              <div>
                <span className="text-[10px] text-white/40 uppercase tracking-widest">Deployed</span>
                <div className="mt-1 flex items-center gap-2">
                  {deployedVersion ? (
                    <>
                      <p className="text-lg text-white tracking-wider">v{deployedVersion}</p>
                      {!deployedDiffers ? (
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                      ) : (
                        <ArrowUpCircle className="w-4 h-4 text-amber-400" />
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-white/40">
                      {isPolling ? 'Checking...' : 'Unknown'}
                    </p>
                  )}
                </div>
                {versionResult?.deployedBuild && (
                  <p className="text-[10px] text-white/30 tracking-widest mt-0.5">build {versionResult.deployedBuild}</p>
                )}
              </div>

              {/* Status */}
              <div>
                <span className="text-[10px] text-white/40 uppercase tracking-widest">Status</span>
                <div className="mt-1">
                  <span
                    className={`inline-block border px-2 py-0.5 text-xs tracking-widest uppercase ${statusColor}`}
                  >
                    {statusLabel}
                  </span>
                </div>
              </div>

              {/* Last checked */}
              <div>
                <span className="text-[10px] text-white/40 uppercase tracking-widest">Last Checked</span>
                <p className="text-sm mt-1 text-white/70">{formatTime(versionResult?.checkedAt)}</p>
              </div>

              {/* Unsynced warning */}
              {unsyncedCount > 0 && (
                <div className="flex items-start gap-2 border border-amber-400/30 bg-amber-400/5 p-3">
                  <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-300/80">
                    {unsyncedCount} unsynced report{unsyncedCount !== 1 ? 's' : ''}. Sync before updating.
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-3 pt-2">
                {updateAvailable ? (
                  <Button
                    onClick={handleApplyUpdate}
                    disabled={applying}
                    className="w-full rounded-none bg-amber-500 hover:bg-amber-400 text-black font-mono text-xs uppercase tracking-widest h-11 animate-pulse disabled:opacity-60"
                  >
                    <Download className="w-3.5 h-3.5 mr-2" />
                    {applying ? 'Applying...' : 'Update Now'}
                  </Button>
                ) : (
                  <Button
                    onClick={handleCheckNow}
                    disabled={isPolling || isCheckingForUpdate}
                    variant="outline"
                    className="w-full rounded-none border-white/20 bg-white/5 text-white/90 hover:bg-white/10 hover:text-white font-mono text-xs uppercase tracking-widest h-10"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-2 ${(isPolling || isCheckingForUpdate) ? 'animate-spin' : ''}`} />
                    Check Now
                  </Button>
                )}

                <Button
                  onClick={handleForceRefreshRequest}
                  variant="outline"
                  className="w-full rounded-none border-red-500/30 bg-red-500/5 text-red-400 hover:bg-red-500/10 hover:text-red-300 font-mono text-xs uppercase tracking-widest h-10"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-2" />
                  Force Refresh (Cache)
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={showForceRefreshDialog} onOpenChange={setShowForceRefreshDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force Refresh</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear all cached data and make the app unavailable offline until you reconnect. Your report data will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleForceRefresh}>Clear Cache & Reload</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showUnsyncedWarning} onOpenChange={setShowUnsyncedWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsynced Data Detected</AlertDialogTitle>
            <AlertDialogDescription>
              You have {unsyncedCount} unsynced report{unsyncedCount !== 1 ? 's' : ''}. We recommend syncing first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSyncFirst} disabled={isSyncing}>
              {isSyncing ? 'Syncing...' : 'Sync First'}
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                setShowUnsyncedWarning(false);
                if (updateAvailable) applyUpdate();
                else setShowForceRefreshDialog(true);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Proceed Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
