/**
 * ReportSyncIndicator Component
 * 
 * Displays the sync status of a report with visual feedback.
 * Shows "Syncing...", "Synced", or "Sync failed" with appropriate icons.
 * Auto-updates when new reports are saved via realtime subscriptions.
 */

import { Cloud, CloudOff, Loader2, CheckCircle, RefreshCw, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';
import { useReportSync, ReportType } from '@/hooks/useReportSync';
import { triggerHaptic } from '@/lib/haptics';

interface ReportSyncIndicatorProps {
  entityId: string | undefined;
  reportType: ReportType;
  className?: string;
  showRetry?: boolean;
  onReportUpdated?: () => void;
}

export const ReportSyncIndicator = ({
  entityId,
  reportType,
  className,
  showRetry = false,
  onReportUpdated,
}: ReportSyncIndicatorProps) => {
  const {
    isSyncing,
    isSynced,
    lastSyncedAt,
    reportVersion,
    error,
    hasLatestReport,
    getLatestReport,
  } = useReportSync(entityId, reportType);

  const handleRetry = async () => {
    triggerHaptic('light');
    const html = await getLatestReport();
    if (html && onReportUpdated) {
      onReportUpdated();
    }
  };

  const getStatusColor = () => {
    if (isSyncing) return 'bg-blue-500/10 text-blue-600 border-blue-200';
    if (error) return 'bg-destructive/10 text-destructive border-destructive/20';
    if (isSynced && hasLatestReport) return 'bg-green-500/10 text-green-600 border-green-200';
    return 'bg-muted text-muted-foreground';
  };

  const getStatusIcon = () => {
    if (isSyncing) return <Loader2 className="h-3 w-3 animate-spin" />;
    if (error) return <AlertCircle className="h-3 w-3" />;
    if (isSynced && hasLatestReport) return <CheckCircle className="h-3 w-3" />;
    return <Cloud className="h-3 w-3" />;
  };

  const getStatusText = () => {
    if (isSyncing) return 'Syncing...';
    if (error) return 'Sync failed';
    if (isSynced && hasLatestReport) return 'Synced';
    return 'No report';
  };

  const getTooltipContent = () => {
    const lines = [];
    
    if (lastSyncedAt) {
      lines.push(`Last synced: ${formatDistanceToNow(lastSyncedAt, { addSuffix: true })}`);
      lines.push(`(${format(lastSyncedAt, 'MMM d, yyyy h:mm a')})`);
    }
    
    if (reportVersion > 0) {
      lines.push(`Version: ${reportVersion}`);
    }
    
    if (error) {
      lines.push(`Error: ${error}`);
    }
    
    return lines.length > 0 ? lines.join('\n') : 'No report generated yet';
  };

  if (!entityId) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn('flex items-center gap-2', className)}>
            <Badge
              variant="outline"
              className={cn(
                'flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium',
                getStatusColor()
              )}
            >
              {getStatusIcon()}
              <span>{getStatusText()}</span>
            </Badge>
            
            {showRetry && error && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRetry}
                className="h-6 w-6 p-0"
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="whitespace-pre-line text-xs">
          {getTooltipContent()}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default ReportSyncIndicator;
