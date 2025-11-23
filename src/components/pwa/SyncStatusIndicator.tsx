import { RefreshCw, AlertCircle, Check, Cloud, Smartphone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePWA } from '@/hooks/usePWA';
import { isMobile, isIOS } from '@/lib/mobile-detection';
import { triggerHaptic } from '@/lib/haptics';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export const SyncStatusIndicator = () => {
  const { 
    unsyncedCount,
    unsyncedInspections,
    isSyncing, 
    lastSyncTime, 
    syncError, 
    triggerSync, 
    isOnline,
    unsyncedPhotoCount 
  } = usePWA();
  
  const isMobileDevice = isMobile();
  const isIOSDevice = isIOS();

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
    if (syncError) return 'destructive';
    if (unsyncedCount > 0 || unsyncedPhotoCount > 0) return 'default';
    return 'outline';
  };

  const getStatusIcon = () => {
    if (isSyncing) return <RefreshCw className="w-4 h-4 animate-spin" />;
    if (syncError) return <AlertCircle className="w-4 h-4" />;
    if (unsyncedCount > 0 || unsyncedPhotoCount > 0) return <Cloud className="w-4 h-4" />;
    return <Check className="w-4 h-4" />;
  };

  const getStatusText = () => {
    if (!isOnline) return 'Offline';
    if (isSyncing) return 'Syncing...';
    if (syncError) return 'Sync Failed';
    const totalUnsynced = unsyncedCount + unsyncedPhotoCount;
    if (totalUnsynced > 0) return `${totalUnsynced} Unsynced`;
    return 'Synced';
  };

  // Show blue sync button on mobile when everything is synced
  const showSyncButton = isMobileDevice && isOnline && !isSyncing && unsyncedCount === 0 && unsyncedPhotoCount === 0;

  const handleSyncWithHaptic = () => {
    triggerHaptic('medium');
    triggerSync();
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2">
            {showSyncButton ? (
              <Button
                variant="default"
                size="sm"
                onClick={handleSyncWithHaptic}
                className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Check className="w-4 h-4" />
                <span>Sync</span>
              </Button>
            ) : (
              <Badge 
                variant={getStatusColor()} 
                className={`gap-2 ${isMobileDevice ? 'text-sm px-3 py-1.5' : ''}`}
              >
                {getStatusIcon()}
                <span>{getStatusText()}</span>
                {isMobileDevice && <Smartphone className="w-3 h-3 opacity-60" />}
              </Badge>
            )}
            {isOnline && !isSyncing && (unsyncedCount > 0 || unsyncedPhotoCount > 0) && (
              <div className="hidden md:flex">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={triggerSync}
                  className="h-8 px-2"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent className={isMobileDevice ? "max-w-xs" : ""}>
          <div className="space-y-1 text-xs">
            <p><strong>Last sync:</strong> {formatLastSync(lastSyncTime)}</p>
            
            {isIOSDevice && (
              <p className="text-muted-foreground italic">
                iOS: Auto-sync every 30 seconds when app is active
              </p>
            )}
            
            {unsyncedCount > 0 && (
              <>
                <p><strong>Unsynced inspections:</strong> {unsyncedCount}</p>
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {unsyncedInspections.map((inspection) => (
                    <div key={inspection.id} className="pl-2 border-l-2 border-muted">
                      <p className="font-medium">{inspection.organization}</p>
                      <p className="text-muted-foreground">{inspection.location}</p>
                      <p className="text-muted-foreground text-[10px]">
                        {new Date(inspection.inspection_date).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
            
            {unsyncedPhotoCount > 0 && (
              <p><strong>Unsynced photos:</strong> {unsyncedPhotoCount}</p>
            )}
            {syncError && <p className="text-destructive">{syncError}</p>}
            {!isOnline && <p>Will sync when back online</p>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
