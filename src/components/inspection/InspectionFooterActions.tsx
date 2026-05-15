import React from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
 * Action button cluster shown at the right of the InspectionForm header bar.
 *
 * Slice 1 of the InspectionForm decomposition. Mirrors TrainingFooterActions.
 * Pure presentational wrapper — no save, load, or completion logic. Forwards
 * click events to the page.
 *
 * Wrapped in React.memo to prevent re-render storms while typing in tables —
 * only re-renders when one of its primitive props changes.
 */
export interface InspectionFooterActionsProps {
  // Visibility / state flags
  effectiveReadOnly: boolean;
  hasId: boolean;
  status: string | undefined;
  isMobile: boolean;
  isAdmin: boolean;
  isOnline: boolean;

  // Save
  isSaving: boolean;
  isAutoSaving: boolean;
  onSave: () => void;
  saveLabel: string; // e.g. "Save Progress" | "Save Locally"

  // Force local backup
  onForceBackup: () => void;

  // Refresh
  refreshing: boolean;
  onRefresh: () => void;

  // Complete
  onComplete: () => void;

  // Generate report (HTML)
  isGeneratingHTML: boolean;
  onGenerateHTML: () => void;

  // Invoice
  isInvoiced: boolean;
  invoiceToggling: boolean;
  onToggleInvoiced: () => void;
}

function InspectionFooterActionsImpl(props: InspectionFooterActionsProps) {
  const {
    effectiveReadOnly,
    hasId,
    status,
    isMobile,
    isAdmin,
    isOnline,
    isSaving,
    isAutoSaving,
    onSave,
    saveLabel,
    onForceBackup,
    refreshing,
    onRefresh,
    onComplete,
    isGeneratingHTML,
    onGenerateHTML,
    isInvoiced,
    invoiceToggling,
    onToggleInvoiced,
  } = props;

  return (
    <div className="flex items-center gap-2">
      {!effectiveReadOnly && (
        <Button
          variant="outline"
          size={isMobile ? "default" : "sm"}
          onClick={onSave}
          disabled={isSaving || isAutoSaving}
        >
          <Save className={isMobile ? "w-5 h-5 mr-1.5" : "w-4 h-4 mr-2"} />
          {isMobile ? (isSaving ? "..." : "Save") : isSaving ? "Saving..." : saveLabel}
        </Button>
      )}
      {hasId && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onForceBackup}
              >
                <HardDrive className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Force Local Backup</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {hasId && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={refreshing || isSaving || isAutoSaving}
                onClick={onRefresh}
              >
                <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh Report Data</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {!effectiveReadOnly && status !== "completed" && (
        <Button
          size={isMobile ? "default" : "sm"}
          onClick={onComplete}
          disabled={isSaving || isAutoSaving}
          className={isMobile ? "min-w-[100px] h-10 text-sm font-medium" : ""}
        >
          <CheckCircle className={isMobile ? "w-5 h-5 mr-1.5" : "w-4 h-4"} />
          <span className={isMobile ? "inline" : "hidden md:inline md:ml-2"}>Complete</span>
        </Button>
      )}
      {status === "completed" && !effectiveReadOnly && (
        <Button
          disabled
          variant="outline"
          size={isMobile ? "default" : "sm"}
          className="opacity-70 cursor-default"
        >
          <CheckCircle className={isMobile ? "w-5 h-5 mr-1.5" : "w-4 h-4"} />
          <span className={isMobile ? "inline" : "hidden md:inline md:ml-2"}>Completed</span>
        </Button>
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
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onGenerateHTML}
                    disabled={isGeneratingHTML || !isOnline}
                  >
                    {isGeneratingHTML ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="hidden md:inline ml-2">Generating...</span>
                      </>
                    ) : (
                      <>
                        <FileText className="w-4 h-4" />
                        <span className="hidden md:inline ml-2">Generate Report</span>
                      </>
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              {!isOnline && <TooltipContent>Must be online to generate report</TooltipContent>}
            </Tooltip>
          </TooltipProvider>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleInvoiced}
              disabled={invoiceToggling}
              className={cn(
                "bg-emerald-500/10 backdrop-blur-md border-emerald-400/30 text-emerald-600 dark:text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.15)] hover:bg-emerald-500/20 hover:text-emerald-700 dark:hover:text-emerald-300",
                isInvoiced &&
                  "bg-emerald-500/25 shadow-[0_0_16px_rgba(16,185,129,0.3)] animate-pulse-calm",
              )}
            >
              <Receipt className="w-4 h-4" />
              <span className="hidden md:inline ml-2">
                {isInvoiced ? "Invoiced ✓" : "Invoice"}
              </span>
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export const InspectionFooterActions = React.memo(InspectionFooterActionsImpl);
InspectionFooterActions.displayName = "InspectionFooterActions";
