import { useState, useEffect } from 'react';
import { usePWA } from '@/hooks/usePWA';
import { isMobile, isIOS } from '@/lib/mobile-detection';
import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';

type Phase = 'idle' | 'syncing' | 'synced' | 'unsynced' | 'error';

/**
 * SyncPulse — minimal dot-based sync indicator.
 * Tappable to open a detail sheet with sync status info.
 */
export const SyncPulse = ({ className }: { className?: string }) => {
  const {
    unsyncedCount,
    unsyncedInspections,
    isSyncing,
    lastSyncTime,
    syncError,
    isOnline,
    unsyncedPhotoCount,
  } = usePWA();

  const isIOSDevice = isIOS();
  const [justSynced, setJustSynced] = useState(false);
  const [previousSyncingState, setPreviousSyncingState] = useState(false);
  const [open, setOpen] = useState(false);

  const totalUnsynced = unsyncedCount + unsyncedPhotoCount;

  // Detect sync completion → show green for 2s then fade
  useEffect(() => {
    if (previousSyncingState && !isSyncing && !syncError) {
      setJustSynced(true);
      const timer = setTimeout(() => setJustSynced(false), 2000);
      return () => clearTimeout(timer);
    }
    setPreviousSyncingState(isSyncing);
  }, [isSyncing, syncError, previousSyncingState]);

  // Derive phase
  let phase: Phase = 'idle';
  if (!isOnline) phase = 'error';
  else if (syncError) phase = 'error';
  else if (isSyncing) phase = 'syncing';
  else if (justSynced) phase = 'synced';
  else if (totalUnsynced > 0) phase = 'unsynced';

  const formatLastSync = (date: Date | null) => {
    if (!date) return 'Never';
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const statusLabel =
    phase === 'syncing' ? 'Syncing...'
    : phase === 'error' ? (isOnline ? 'Sync Failed' : 'Offline')
    : phase === 'unsynced' ? `${totalUnsynced} Unsynced`
    : phase === 'synced' ? 'Synced'
    : 'All Synced';

  return (
    <>
      <button
        type="button"
        aria-label="Sync status"
        onClick={() => setOpen(true)}
        className={cn('relative flex items-center justify-center w-8 h-8', className)}
      >
        <div
          className={cn(
            'w-2 h-2 rounded-full transition-all duration-500 ease-in-out',
            phase === 'syncing' && 'bg-blue-500 opacity-90 animate-[pulse_2s_ease-in-out_infinite]',
            phase === 'error' && 'bg-destructive opacity-100',
            phase === 'unsynced' && 'bg-amber-500 opacity-80',
            phase === 'synced' && 'bg-green-500 opacity-100',
            phase === 'idle' && 'opacity-0',
          )}
        />
        {totalUnsynced > 0 && phase !== 'syncing' && (
          <span className="absolute -top-0.5 -right-0.5 text-[9px] font-mono leading-none bg-amber-500 text-white rounded-full min-w-[14px] h-[14px] flex items-center justify-center">
            {totalUnsynced}
          </span>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-xl max-h-[70vh] overflow-y-auto">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-base">Sync Status</SheetTitle>
            <SheetDescription className="sr-only">Details about data synchronization</SheetDescription>
          </SheetHeader>

          <div className="space-y-4 text-sm px-1 pb-4">
            {/* Status row */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className="font-medium">{statusLabel}</span>
            </div>

            {/* Last sync */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Last sync</span>
              <span className="font-medium">{formatLastSync(lastSyncTime)}</span>
            </div>

            {/* Pending reports */}
            {unsyncedCount > 0 && (
              <div className="space-y-2">
                <p className="font-medium">Pending reports ({unsyncedCount})</p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {unsyncedInspections.slice(0, 8).map((inspection) => (
                    <div key={inspection.id} className="pl-3 border-l-2 border-muted">
                      <p className="font-medium text-foreground">{inspection.organization}</p>
                      <p className="text-muted-foreground text-xs">{inspection.location}</p>
                    </div>
                  ))}
                  {unsyncedInspections.length > 8 && (
                    <p className="text-muted-foreground text-xs pl-3">+{unsyncedInspections.length - 8} more</p>
                  )}
                </div>
              </div>
            )}

            {/* Pending photos */}
            {unsyncedPhotoCount > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Pending photos</span>
                <span className="font-medium">{unsyncedPhotoCount}</span>
              </div>
            )}

            {/* Error */}
            {syncError && (
              <p className="text-destructive text-xs bg-destructive/10 rounded-md p-2">{syncError}</p>
            )}

            {/* Offline notice */}
            {!isOnline && (
              <p className="text-muted-foreground text-xs">Changes will sync when back online.</p>
            )}

            {/* Info footer */}
            <p className="text-muted-foreground text-xs italic pt-1 border-t border-border">
              Sync happens automatically in the background.
              {isIOSDevice && ' On iOS, auto-sync runs on visibility change and every 30 seconds.'}
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};
