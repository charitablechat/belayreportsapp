import { CheckCircle, Loader2, AlertCircle, Clock, RefreshCw, CloudOff, Eye } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { isLovablePreview } from "@/lib/environment";

type SaveErrorLike =
  | string
  | { message: string; code?: string }
  | null
  | undefined;

interface AutoSaveIndicatorProps {
  lastSaved: Date | null;
  isSaving?: boolean;
  hasUnsavedChanges?: boolean;
  error?: SaveErrorLike;
  className?: string;
  showRelativeTime?: boolean;
  onRetry?: () => void;
}

function normalizeError(error: SaveErrorLike): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  return error.message ?? null;
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
  const formatTimeMobile = (date: Date) => format(date, "h:mm a");
  const formatTimeDesktop = (date: Date) => format(date, "h:mm:ss a");

  // Glassmorphism pill on mobile, plain inline on desktop
  const mobilePill = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 dark:bg-black/30 backdrop-blur-xl border border-white/20 shadow-md shadow-black/5";

  // Lovable preview: show read-only badge instead of any save state
  if (isLovablePreview()) {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs font-mono text-muted-foreground", mobilePill, className)}>
        <Eye className="w-3 h-3" />
        <span className="hidden sm:inline">PREVIEW — READ ONLY</span>
        <span className="sm:hidden">Preview</span>
      </div>
    );
  }

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
      <div className={cn("flex items-center gap-1.5 text-xs font-mono text-emerald-400", mobilePill, className)}>
        <CheckCircle className="w-3 h-3" />
        <span className="sm:hidden">Saved {formatTimeMobile(lastSaved)}</span>
        <span className="hidden sm:inline">Manually Saved at {formatTimeDesktop(lastSaved)}</span>
      </div>
    );
  }

  if (hasUnsavedChanges) {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs font-mono text-amber-400", mobilePill, className)}>
        <Clock className="w-3 h-3" />
        <span className="hidden sm:inline">Unsaved changes</span>
        <span className="sm:hidden">Unsaved</span>
      </div>
    );
  }

  return null;
}
