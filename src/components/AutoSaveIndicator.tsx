import { CheckCircle, Loader2, AlertCircle, Clock, RefreshCw, CloudOff } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface AutoSaveIndicatorProps {
  lastSaved: Date | null;
  isSaving?: boolean;
  hasUnsavedChanges?: boolean;
  error?: string | null;
  className?: string;
  showRelativeTime?: boolean;
  onRetry?: () => void;
}

export function AutoSaveIndicator({
  lastSaved,
  isSaving = false,
  hasUnsavedChanges = false,
  error = null,
  className,
  showRelativeTime = true,
  onRetry,
}: AutoSaveIndicatorProps) {
  const formatTime = (date: Date) => {
    if (showRelativeTime) {
      const now = new Date();
      const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
      
      if (diffInSeconds < 10) return "just now";
      if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
      if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
      
      return format(date, "h:mm a");
    }
    return format(date, "h:mm:ss a");
  };

  // Glassmorphism pill on mobile, plain inline on desktop
  const mobilePill = "sm:bg-transparent sm:backdrop-blur-none sm:border-0 sm:rounded-none sm:px-0 sm:py-0 bg-slate-900/60 backdrop-blur-sm border border-white/10 rounded-sm px-2 py-0.5";

  // Special handling for "pending_sync" - show non-alarming state
  if (error === 'pending_sync') {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs font-mono text-muted-foreground", mobilePill, className)}>
        <CloudOff className="w-3 h-3" />
        <span className="hidden sm:inline">Saved locally • will sync</span>
        <span className="sm:hidden">Pending</span>
      </div>
    );
  }

  // Regular error state (for validation errors, etc.)
  if (error) {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs font-mono text-destructive", mobilePill, className)}>
        <AlertCircle className="w-3 h-3" />
        <span className="hidden sm:inline">{error}</span>
        <span className="sm:hidden">Error</span>
        {onRetry && (
          <button 
            onClick={onRetry}
            className="ml-1 p-0.5 rounded hover:bg-destructive/10 transition-colors"
            title="Retry save"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  if (isSaving) {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs font-mono text-primary", mobilePill, className)}>
        <Loader2 className="w-3 h-3 animate-spin" />
        <span className="hidden sm:inline">Saving...</span>
      </div>
    );
  }

  if (lastSaved) {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs font-mono text-green-600 dark:text-green-400", mobilePill, className)}>
        <CheckCircle className="w-3 h-3" />
        <span className="hidden sm:inline">Saved {formatTime(lastSaved)}</span>
        <span className="sm:hidden">Saved</span>
      </div>
    );
  }

  if (hasUnsavedChanges) {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs font-mono text-yellow-600 dark:text-yellow-400", mobilePill, className)}>
        <Clock className="w-3 h-3" />
        <span className="hidden sm:inline">Unsaved changes</span>
        <span className="sm:hidden">Unsaved</span>
      </div>
    );
  }

  return null;
}
