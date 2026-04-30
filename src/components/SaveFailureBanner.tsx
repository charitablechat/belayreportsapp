import { useState, useRef } from "react";
import { AlertTriangle, RefreshCw, Copy, Check, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isLovablePreview } from "@/lib/environment";
import type { IdbSaveErrorCode } from "@/lib/offline-storage";

export type SaveErrorState =
  | { message: string; code?: IdbSaveErrorCode }
  | "pending_sync"
  | null;

interface SaveFailureBannerProps {
  saveError: SaveErrorState;
  onRetry: () => void | Promise<void>;
  onExportDraft: () => Record<string, unknown>;
  reportType: "inspection" | "training" | "daily-assessment";
  reportId?: string | null;
  className?: string;
}

function explainCode(code?: IdbSaveErrorCode): string {
  switch (code) {
    case "quota_exceeded":
      return "Your device storage is full. Free up space (delete photos/apps) and retry.";
    case "storage_unavailable":
      return "Both fast and backup storage are unavailable on this device.";
    case "idb_unhealthy":
      return "Your browser's local database is in a bad state. A page reload may help.";
    case "idb_closing":
      return "The save was interrupted by a tab switch or device lock. Tap Retry to save again.";
    case "timeout":
      return "The save took too long to complete. Your device may be under heavy load.";
    case "unknown":
    default:
      return "An unexpected error blocked the save. Use the buttons below to rescue your draft.";
  }
}

export function SaveFailureBanner({
  saveError,
  onRetry,
  onExportDraft,
  reportType,
  reportId,
  className,
}: SaveFailureBannerProps) {
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const fallbackRef = useRef<HTMLTextAreaElement | null>(null);

  // Suppress in preview (matches AutoSaveIndicator behavior)
  if (isLovablePreview()) return null;
  if (!saveError || saveError === "pending_sync") return null;

  const message = saveError.message;
  const code = saveError.code;
  const explanation = explainCode(code);

  const buildPayload = (): string => {
    try {
      const snapshot = onExportDraft();
      return JSON.stringify(snapshot, null, 2);
    } catch (err) {
      console.error("[SaveFailureBanner] buildPayload failed:", err);
      return JSON.stringify(
        { error: "Failed to build draft snapshot", message: String(err) },
        null,
        2,
      );
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  const handleCopy = async () => {
    const payload = buildPayload();
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(payload);
        setCopied(true);
        toast.success("Draft copied to clipboard", {
          description: "Paste it somewhere safe (Notes, email to yourself, etc.)",
        });
        setTimeout(() => setCopied(false), 3000);
        return;
      }
      throw new Error("Clipboard API unavailable");
    } catch (err) {
      console.warn("[SaveFailureBanner] clipboard failed, falling back:", err);
      setFallbackText(payload);
      // Auto-select after render
      setTimeout(() => {
        fallbackRef.current?.focus();
        fallbackRef.current?.select();
      }, 50);
      toast.info("Long-press the text below to copy", {
        description: "Clipboard access is blocked in this context.",
      });
    }
  };

  const handleDownload = () => {
    try {
      const payload = buildPayload();
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const idShort = (reportId || "unknown").slice(0, 8);
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const a = document.createElement("a");
      a.href = url;
      a.download = `rope-works-draft-${reportType}-${idShort}-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Draft downloaded", {
        description: "Send the .json file to support to recover your data.",
      });
    } catch (err) {
      console.error("[SaveFailureBanner] download failed:", err);
      toast.error("Download failed", {
        description: "Try the Copy button instead.",
      });
    }
  };

  return (
    <div
      className={cn(
        "sticky top-0 z-40 w-full border-b border-destructive/40 bg-destructive/10 backdrop-blur-xl shadow-lg shadow-destructive/10",
        className,
      )}
      role="alert"
      aria-live="assertive"
    >
      <div className="container mx-auto px-3 md:px-4 py-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-destructive">
              Save failed — your changes are NOT stored on this device.
            </h3>
            <p className="text-xs text-foreground/90 mt-1">{explanation}</p>

            <div className="flex flex-wrap gap-2 mt-3">
              <Button
                size="sm"
                variant="default"
                onClick={handleRetry}
                disabled={retrying}
                className="gap-1.5"
              >
                {retrying ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Retry save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopy}
                className="gap-1.5"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-success" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copied ? "Copied" : "Copy draft to clipboard"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownload}
                className="gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Download draft (.json)
              </Button>
            </div>

            {fallbackText && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground mb-1">
                  Long-press the text below, choose "Select All", then "Copy":
                </p>
                <textarea
                  ref={fallbackRef}
                  value={fallbackText}
                  readOnly
                  className="w-full h-32 text-xs font-mono p-2 rounded border border-border bg-background/80"
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
              </div>
            )}

            <details className="mt-2">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Show technical details
              </summary>
              <pre className="text-xs font-mono mt-1 p-2 rounded bg-background/60 border border-border overflow-x-auto">
                {`code: ${code ?? "n/a"}\nmessage: ${message}`}
              </pre>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
