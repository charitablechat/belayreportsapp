/**
 * ImportRetryBanner.tsx
 *
 * Renders a destructive-styled alert when a previous inspection import left
 * child rows un-inserted (cached in localStorage by import-retry.ts).
 *
 * - Renders nothing if no cached payload exists for the given inspectionId.
 * - "Retry Import" button re-attempts the failed inserts via retryFailedImport()
 *   and dispatches the existing `report-data-imported` event so InspectionForm
 *   reloads its state from IndexedDB.
 * - "Dismiss" button clears the cache for users who prefer to re-enter manually.
 *
 * Cross-platform: uses only localStorage (via import-retry helpers) and the
 * standard DOM CustomEvent — no platform branches required.
 */

import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import {
  loadFailedImportPayload,
  clearFailedImportPayload,
  retryFailedImport,
  type ChildTable,
  type FailedImportPayload,
} from "@/lib/import-retry";

interface ImportRetryBannerProps {
  inspectionId: string;
}

export function ImportRetryBanner({ inspectionId }: ImportRetryBannerProps) {
  const [payload, setPayload] = useState<FailedImportPayload | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    setPayload(loadFailedImportPayload(inspectionId));
  }, [inspectionId]);

  if (!payload) return null;

  const failedTables = Object.keys(payload.tables) as ChildTable[];
  if (failedTables.length === 0) return null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const { failed, succeeded } = await retryFailedImport(inspectionId);

      if (failed.length === 0) {
        toast.success("Imported items recovered", {
          description: `${succeeded.length} table${succeeded.length !== 1 ? "s" : ""} successfully written.`,
        });
        // Dispatch the existing event so InspectionForm reloads its state
        window.dispatchEvent(
          new CustomEvent("report-data-imported", {
            detail: { reportType: "inspection", reportId: inspectionId },
          })
        );
        setPayload(null);
      } else {
        toast.warning("Some items still failed", {
          description: `${failed.join(", ")} could not be written. Try again or dismiss to re-enter manually.`,
        });
        // Refresh banner to show the updated (reduced) list
        setPayload(loadFailedImportPayload(inspectionId));
      }
    } catch (err) {
      console.error("[ImportRetryBanner] Unexpected error during retry:", err);
      toast.error("Retry failed unexpectedly", {
        description: "Please try again or reload the page.",
      });
    } finally {
      setRetrying(false);
    }
  };

  const handleDismiss = () => {
    clearFailedImportPayload(inspectionId);
    setPayload(null);
  };

  return (
    <Alert className="border-destructive/60 bg-destructive/10 mb-4">
      <AlertTriangle className="h-4 w-4 text-destructive" />
      <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm text-destructive">
          <strong>Some imported items did not save.</strong>{" "}
          <span className="text-muted-foreground">
            {failedTables.join(", ")} could not be written.
          </span>
        </span>
        <div className="flex gap-2 shrink-0">
          <Button
            size="sm"
            variant="destructive"
            onClick={handleRetry}
            disabled={retrying}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
            {retrying ? "Retrying…" : "Retry Import"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDismiss}
            disabled={retrying}
            className="gap-1.5"
          >
            <X className="h-3.5 w-3.5" />
            Dismiss
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
