import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CloudOff, AlertTriangle, WifiOff, RefreshCw } from "lucide-react";
import belayReportsLogo from "@/assets/belay-reports-logo.png";
import { AutoSaveIndicator } from "@/components/AutoSaveIndicator";
import { ForceSyncButton } from "@/components/pwa/ForceSyncButton";
import type { SaveErrorState } from "@/components/SaveFailureBanner";
import { cn } from "@/lib/utils";
import {
  InspectionFooterActions,
  type InspectionFooterActionsProps,
} from "@/components/inspection/InspectionFooterActions";

/**
 * The full top-of-page header region for the InspectionForm:
 *   - Offline banner
 *   - Storage-unavailable banner
 *   - Offline-empty-data banner
 *   - Sticky <header> with back button, logo, status indicators
 *     (Offline / versioning / pending sync / save error retry / AutoSave),
 *     and the InspectionFooterActions button cluster
 *
 * Slice 1 of the InspectionForm decomposition. Wrapped in React.memo. The
 * action button cluster is its own memoized component so banner re-renders
 * don't cascade into the actions (and vice versa).
 */
export interface InspectionHeaderSectionProps {
  // Banners
  isOnline: boolean;
  storageUnavailable: boolean;
  showOfflineEmptyBanner: boolean;

  // Header bar — left side
  onBack: () => void;

  // Status indicators
  saveError: SaveErrorState | "pending_sync" | null;
  isSyncing: boolean;
  isSaving: boolean;
  isAutoSaving: boolean;
  hasUnsavedChanges: boolean;
  lastManuallySaved: Date | null;
  versioningFailures: number;
  onRetrySave: () => void;
  onWarnVersioning: () => void;

  // Actions
  actions: InspectionFooterActionsProps;
}

function InspectionHeaderSectionImpl(props: InspectionHeaderSectionProps) {
  const {
    isOnline,
    storageUnavailable,
    showOfflineEmptyBanner,
    onBack,
    saveError,
    isSyncing,
    isSaving,
    isAutoSaving,
    hasUnsavedChanges,
    lastManuallySaved,
    versioningFailures,
    onRetrySave,
    onWarnVersioning,
    actions,
  } = props;

  const realError = saveError && saveError !== "pending_sync" ? saveError : null;

  return (
    <>
      {/* Offline Mode Banner */}
      {!isOnline && (
        <div className="bg-orange-500/10 border-b border-orange-500/20">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-3">
              <CloudOff className="w-5 h-5 text-orange-600 dark:text-orange-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-orange-900 dark:text-orange-100">
                  You're working offline
                </p>
                <p className="text-xs text-orange-700 dark:text-orange-300 mt-0.5">
                  Changes will be saved locally and synced when you're back online
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Storage Unavailable Banner (Vector A: circuit breaker tripped) */}
      {storageUnavailable && (
        <div className="bg-destructive/10 border-b border-destructive/20">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-destructive">
                  Local storage unavailable
                </p>
                <p className="text-xs text-destructive/80 mt-0.5">
                  Your changes are at risk. Please stay connected to sync your work.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Offline Empty Data Banner (Vector E) */}
      {showOfflineEmptyBanner && (
        <div className="bg-muted border-b border-border">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-3">
              <WifiOff className="w-5 h-5 text-muted-foreground shrink-0" />
              <p className="text-sm text-muted-foreground">
                Report details not available offline. Connect to the internet to load full data.
              </p>
            </div>
          </div>
        </div>
      )}

      <header className="border-b border-white/20 bg-white/10 dark:bg-black/20 backdrop-blur-[12px] shadow-md shadow-black/5 sticky top-0 z-20">
        <div className="container mx-auto px-2 sm:px-4 py-2 sm:py-4">
          {/* Top row */}
          <div className="flex items-center justify-between mb-2 sm:mb-0">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={onBack}>
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <img
                src={belayReportsLogo}
                alt="Belay Reports"
                className="h-8 sm:h-10 w-auto object-contain"
              />
            </div>
          </div>

          {/* Bottom row - status indicators + actions */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              {!isOnline && (
                <Badge variant="secondary" className="gap-2 text-xs">
                  <WifiOff className="w-3 h-3" />
                  <span className="hidden sm:inline">Offline Mode</span>
                </Badge>
              )}
              {/* M9: Versioning health warning */}
              {versioningFailures >= 3 && (
                <Badge
                  variant="destructive"
                  className="gap-1.5 text-xs cursor-pointer"
                  onClick={onWarnVersioning}
                  title="Tap for details"
                >
                  <span>Recovery snapshots failing ({versioningFailures})</span>
                </Badge>
              )}
              {/* Pending sync indicator with retry option */}
              {saveError === "pending_sync" && isOnline && (
                <div className="flex items-center gap-1.5">
                  <Badge variant="secondary" className="gap-1.5 text-xs bg-muted/50">
                    <CloudOff className="w-3 h-3" />
                    <span className="hidden sm:inline">Pending sync</span>
                  </Badge>
                  <ForceSyncButton variant="icon" className="h-7 w-7" />
                </div>
              )}
              {/* Real save errors get the retry button */}
              {realError && isOnline && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onRetrySave}
                    disabled={isSaving || isAutoSaving || isSyncing}
                    className="gap-1.5 text-xs h-7"
                  >
                    <RefreshCw className={cn("w-3 h-3", isSyncing && "animate-spin")} />
                    <span className="hidden sm:inline">Retry Save</span>
                  </Button>
                  <ForceSyncButton variant="icon" className="h-7 w-7" />
                </>
              )}
              <AutoSaveIndicator
                lastSaved={lastManuallySaved}
                isSaving={isSaving}
                hasUnsavedChanges={hasUnsavedChanges}
                error={realError}
                className="flex"
              />
            </div>

            <InspectionFooterActions {...actions} />
          </div>
        </div>
      </header>
    </>
  );
}

export const InspectionHeaderSection = React.memo(InspectionHeaderSectionImpl);
InspectionHeaderSection.displayName = "InspectionHeaderSection";
