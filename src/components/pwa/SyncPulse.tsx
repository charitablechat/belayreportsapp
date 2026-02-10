import { useState, useEffect } from 'react';
import { usePWA } from '@/hooks/usePWA';
import { isMobile, isIOS } from '@/lib/mobile-detection';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type Phase = 'idle' | 'syncing' | 'synced' | 'unsynced' | 'error';

/**
 * SyncPulse — minimal dot-based sync indicator.
 * Replaces the old SyncStatusIndicator badge in the header.
 * Never shifts layout; uses fixed dimensions with opacity-only transitions.
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

  const isMobileDevice = isMobile();
  const isIOSDevice = isIOS();
  const [justSynced, setJustSynced] = useState(false);
  const [previousSyncingState, setPreviousSyncingState] = useState(false);

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

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn('relative flex items-center justify-center w-8 h-8', className)}>
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
          </div>
        </TooltipTrigger>
        <TooltipContent className={isMobileDevice ? 'max-w-xs' : ''}>
          <div className="space-y-1 text-xs">
            <p>
              <strong>Status:</strong>{' '}
              {phase === 'syncing' ? 'Syncing...' : phase === 'error' ? (isOnline ? 'Sync Failed' : 'Offline') : phase === 'unsynced' ? `${totalUnsynced} Unsynced` : phase === 'synced' ? 'Synced' : 'All synced'}
            </p>
            <p><strong>Last sync:</strong> {formatLastSync(lastSyncTime)}</p>
            <p className="text-muted-foreground italic">Sync happens automatically in the background</p>
            {isIOSDevice && (
              <p className="text-muted-foreground italic">iOS: Auto-sync on visibility change and every 30 seconds</p>
            )}
            {unsyncedCount > 0 && (
              <>
                <p><strong>Pending items:</strong> {unsyncedCount}</p>
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {unsyncedInspections.slice(0, 5).map((inspection) => (
                    <div key={inspection.id} className="pl-2 border-l-2 border-muted">
                      <p className="font-medium">{inspection.organization}</p>
                      <p className="text-muted-foreground">{inspection.location}</p>
                    </div>
                  ))}
                  {unsyncedInspections.length > 5 && (
                    <p className="text-muted-foreground">+{unsyncedInspections.length - 5} more</p>
                  )}
                </div>
              </>
            )}
            {unsyncedPhotoCount > 0 && <p><strong>Pending photos:</strong> {unsyncedPhotoCount}</p>}
            {syncError && <p className="text-destructive">{syncError}</p>}
            {!isOnline && <p>Changes will sync when back online</p>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
