import React from "react";
import { Button } from "@/components/ui/button";
import {
  Save,
  HardDrive,
  RefreshCw,
  CheckCircle,
  Loader2,
  FileText,
  Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Action button cluster shown at the right of the TrainingForm header bar.
 *
 * Slice 1 of the TrainingForm decomposition. This component is a pure
 * presentational wrapper around the button cluster — it contains no save,
 * load, or completion logic; it only forwards click events to the parent.
 *
 * NOTE: Despite the "FooterActions" name (kept to match the planning doc),
 * these buttons currently render inside the page's sticky <header>. The name
 * refers to their semantic role (terminal-row actions), not their position.
 *
 * Wrapped in React.memo to prevent re-render storms — only re-renders when
 * one of its primitive props changes.
 */
export interface TrainingFooterActionsProps {
  // Visibility / state flags
  effectiveReadOnly: boolean;
  hasId: boolean;
  status: string | undefined;
  isMobile: boolean;
  isAdmin: boolean;

  // Save
  isSaving: boolean;
  onSave: () => void;

  // Force local backup
  onForceBackup: () => void;

  // Refresh
  refreshing: boolean;
  onRefresh: () => void;

  // Complete
  onComplete: () => void;

  // Generate report (HTML)
  isGeneratingHTML: boolean;
  isOnline: boolean;
  onGenerateHTML: () => void;

  // Invoice
  isInvoiced: boolean;
  invoiceToggling: boolean;
  onToggleInvoiced: () => void;
}

function TrainingFooterActionsImpl(props: TrainingFooterActionsProps) {
  const {
    effectiveReadOnly,
    hasId,
    status,
    isMobile,
    isAdmin,
    isSaving,
    onSave,
    onForceBackup,
    refreshing,
    onRefresh,
    onComplete,
    isGeneratingHTML,
    isOnline,
    onGenerateHTML,
    isInvoiced,
    invoiceToggling,
    onToggleInvoiced,
  } = props;

  return (
    <div className="flex items-center gap-2">
      {!effectiveReadOnly && (
        <>
          <Button
            variant="outline"
            size={isMobile ? "default" : "sm"}
            onClick={onSave}
            disabled={isSaving}
          >
            <Save className={isMobile ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
            {isMobile
              ? isSaving
                ? "..."
                : "Save"
              : isSaving
                ? "Saving..."
                : "Save Progress"}
          </Button>
          {hasId && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Force Local Backup"
              onClick={onForceBackup}
            >
              <HardDrive className="w-4 h-4" />
            </Button>
          )}
          {hasId && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Refresh Report Data"
              disabled={refreshing || isSaving}
              onClick={onRefresh}
            >
              <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
            </Button>
          )}
          {status !== "completed" && (
            <Button
              size={isMobile ? "default" : "sm"}
              onClick={onComplete}
              disabled={isSaving}
              className={isMobile ? "min-w-[100px] h-10 text-sm font-medium" : ""}
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <CheckCircle className={isMobile ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                  <span>Complete</span>
                </>
              )}
            </Button>
          )}
          {status === "completed" && (
            <Button
              disabled
              variant="outline"
              size={isMobile ? "default" : "sm"}
              className="opacity-70 cursor-default"
            >
              <CheckCircle className={isMobile ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
              <span>Completed</span>
            </Button>
          )}
        </>
      )}
      {status === "completed" && (
        <>
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onGenerateHTML}
              disabled={isGeneratingHTML || !isOnline}
              className="h-9 w-9"
            >
              <RefreshCw className={cn("w-4 h-4", isGeneratingHTML && "animate-spin")} />
            </Button>
          )}
          <Button
            variant="outline"
            size={isMobile ? "default" : "sm"}
            onClick={onGenerateHTML}
            disabled={isGeneratingHTML || !isOnline}
          >
            {isGeneratingHTML ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <FileText className={isMobile ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
                {isMobile ? "" : "Generate Report"}
              </>
            )}
          </Button>
          {isAdmin && (
            <Button
              variant="outline"
              size={isMobile ? "default" : "sm"}
              onClick={onToggleInvoiced}
              disabled={invoiceToggling}
              className={cn(
                "bg-emerald-500/10 backdrop-blur-md border-emerald-400/30 text-emerald-600 dark:text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.15)] hover:bg-emerald-500/20 hover:text-emerald-700 dark:hover:text-emerald-300",
                isInvoiced &&
                  "bg-emerald-500/25 shadow-[0_0_16px_rgba(16,185,129,0.3)] animate-pulse-calm"
              )}
            >
              <Receipt className={isMobile ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
              {isMobile ? "" : isInvoiced ? "Invoiced ✓" : "Invoice"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export const TrainingFooterActions = React.memo(TrainingFooterActionsImpl);
TrainingFooterActions.displayName = "TrainingFooterActions";
