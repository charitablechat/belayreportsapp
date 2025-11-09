import { RefreshCw, AlertCircle, Check, Cloud } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePWA } from '@/hooks/usePWA';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export const SyncStatusIndicator = () => {
  const { unsyncedCount, isSyncing, lastSyncTime, syncError, triggerSync, isOnline } = usePWA();

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
    if (unsyncedCount > 0) return 'default';
    return 'outline';
  };

  const getStatusIcon = () => {
    if (isSyncing) return <RefreshCw className="w-4 h-4 animate-spin" />;
    if (syncError) return <AlertCircle className="w-4 h-4" />;
    if (unsyncedCount > 0) return <Cloud className="w-4 h-4" />;
    return <Check className="w-4 h-4" />;
  };

  const getStatusText = () => {
    if (!isOnline) return 'Offline';
    if (isSyncing) return 'Syncing...';
    if (syncError) return 'Sync Failed';
    if (unsyncedCount > 0) return `${unsyncedCount} Unsynced`;
    return 'Synced';
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2">
            <Badge variant={getStatusColor()} className="gap-2">
              {getStatusIcon()}
              <span>{getStatusText()}</span>
            </Badge>
            {isOnline && !isSyncing && unsyncedCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={triggerSync}
                className="h-8 px-2"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1 text-xs">
            <p><strong>Last sync:</strong> {formatLastSync(lastSyncTime)}</p>
            {syncError && <p className="text-destructive">{syncError}</p>}
            {!isOnline && <p>Will sync when back online</p>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
