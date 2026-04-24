import { RefreshCw, AlertCircle, Check, Cloud, Smartphone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { usePWA } from '@/hooks/usePWA';
import { isMobile, isIOS } from '@/lib/mobile-detection';
import { useState, useEffect } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Passive sync status indicator - shows sync state without manual trigger
 * All sync operations are now fully automatic
 */
export const SyncStatusIndicator = () => {
  const {
    unsyncedCount,
    unsyncedInspections,
    isSyncing,
    lastSyncTime,
    syncError,
    syncErrorSeverity,
    isOnline,
    unsyncedPhotoCount
  } = usePWA();
  const isMobileDevice = isMobile();
  const isIOSDevice = isIOS();
  const [justSynced, setJustSynced] = useState(false);
  const [previousSyncingState, setPreviousSyncingState] = useState(false);

  // S42 (Fix F): only fatal-severity errors render as Sync Failed.
  const isFatalError = syncError !== null && syncErrorSeverity === 'fatal';

  // Detect when sync completes
  useEffect(() => {
    if (previousSyncingState && !isSyncing && !syncError) {
      // Sync just completed successfully
      setJustSynced(true);

      // Reset animation after 2 seconds
      const timer = setTimeout(() => {
        setJustSynced(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
    setPreviousSyncingState(isSyncing);
  }, [isSyncing, syncError, previousSyncingState]);

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

  const getStatusColor = () => {
    if (!isOnline) return 'secondary';
    if (isFatalError) return 'destructive';
    if (unsyncedCount > 0 || unsyncedPhotoCount > 0) return 'default';
    return 'outline';
  };

  const getStatusIcon = () => {
    if (isSyncing) return <RefreshCw className="w-4 h-4 animate-spin" />;
    if (isFatalError) return <AlertCircle className="w-4 h-4" />;
    if (unsyncedCount > 0 || unsyncedPhotoCount > 0) return <Cloud className="w-4 h-4" />;
    return <Check className="w-4 h-4" />;
  };

  const getStatusText = () => {
    if (!isOnline) return 'Offline';
    if (isSyncing) return 'Syncing...';
    if (isFatalError) return 'Sync Failed';
    const totalUnsynced = unsyncedCount + unsyncedPhotoCount;
    if (totalUnsynced > 0) return `${totalUnsynced} Unsynced`;
    return 'Synced';
  };

  const totalUnsynced = unsyncedCount + unsyncedPhotoCount;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant={getStatusColor()} 
            className={`flex items-center gap-1.5 cursor-default transition-all duration-300 ${
              justSynced ? 'scale-110 bg-green-500' : ''
            }`}
          >
            {getStatusIcon()}
            <span className="hidden sm:inline">{getStatusText()}</span>
            {totalUnsynced > 0 && !isSyncing && (
              <span className="ml-1 text-xs opacity-75">({totalUnsynced})</span>
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className={isMobileDevice ? "max-w-xs" : ""}>
          <div className="space-y-1 text-xs">
            <p><strong>Status:</strong> {getStatusText()}</p>
            <p><strong>Last sync:</strong> {formatLastSync(lastSyncTime)}</p>
            
            <p className="text-muted-foreground italic">
              Sync happens automatically in the background
            </p>
            
            {isIOSDevice && (
              <p className="text-muted-foreground italic">
                iOS: Auto-sync on visibility change and every 30 seconds
              </p>
            )}
            
            {unsyncedCount > 0 && (
              <>
                <p><strong>Pending items:</strong> {unsyncedCount}</p>
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {unsyncedInspections.slice(0, 5).map(inspection => (
                    <div key={inspection.id} className="pl-2 border-l-2 border-muted">
                      <p className="font-medium">{inspection.organization}</p>
                      <p className="text-muted-foreground">{inspection.location}</p>
                    </div>
                  ))}
                  {unsyncedInspections.length > 5 && (
                    <p className="text-muted-foreground">
                      +{unsyncedInspections.length - 5} more
                    </p>
                  )}
                </div>
              </>
            )}
            
            {unsyncedPhotoCount > 0 && (
              <p><strong>Pending photos:</strong> {unsyncedPhotoCount}</p>
            )}
            
            {syncError && <p className="text-destructive">{syncError}</p>}
            
            {!isOnline && <p>Changes will sync when back online</p>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
