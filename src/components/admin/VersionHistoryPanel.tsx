/**
 * Version History Panel — Glassmorphism slide-out
 * 
 * Shows all immutable versions for a report with restore capability.
 * Frosted glass aesthetic matching the broader UI design system.
 */

import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RotateCcw, Smartphone, Monitor, Clock, Shield, Database } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  getVersionHistory,
  restoreVersion,
  type ReportVersion,
  type ReportType,
} from "@/lib/report-version-manager";

interface VersionHistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportType: ReportType;
  reportId: string;
  onRestore?: () => void;
}

const triggerLabels: Record<string, string> = {
  auto_save: 'AUTO',
  manual_save: 'MANUAL',
  emergency_save: 'EMERGENCY',
  pre_sync: 'PRE-SYNC',
};

export function VersionHistoryPanel({
  open,
  onOpenChange,
  reportType,
  reportId,
  onRestore,
}: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<ReportVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    if (open && reportId) {
      loadVersions();
    }
  }, [open, reportId]);

  const loadVersions = async () => {
    setLoading(true);
    try {
      const history = await getVersionHistory(reportId);
      setVersions(history);
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (version: ReportVersion) => {
    setRestoring(version.id);
    try {
      const success = await restoreVersion(reportType, reportId, version.id);
      if (success) {
        toast.success(`Restored v${version.versionNumber}`, {
          description: "Reload the page to see restored data.",
        });
        onRestore?.();
      } else {
        toast.error("Restore failed");
      }
    } catch {
      toast.error("Restore failed");
    } finally {
      setRestoring(null);
    }
  };

  const formatTimestamp = (ts: number) => {
    try {
      return format(new Date(ts), "MMM d, h:mm:ss a");
    } catch {
      return "N/A";
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:w-[420px] bg-background/95 backdrop-blur-xl border-l border-white/15"
      >
        <SheetHeader className="border-b border-white/10 pb-4">
          <SheetTitle className="font-mono text-foreground flex items-center gap-2">
            <Database className="h-4 w-4" />
            VERSION HISTORY
          </SheetTitle>
          <SheetDescription className="font-mono text-muted-foreground text-xs">
            {versions.length} immutable snapshots • {reportType.replace(/_/g, ' ')}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-2 overflow-y-auto max-h-[calc(100vh-140px)] pr-1">
          {loading ? (
            <div className="text-center py-8 font-mono text-muted-foreground/40 text-xs">
              LOADING VERSIONS...
            </div>
          ) : versions.length === 0 ? (
            <div className="text-center py-8 font-mono text-muted-foreground/40 text-xs">
              NO VERSIONS AVAILABLE
              <br />
              <span className="text-muted-foreground/25">Versions are created on each save</span>
            </div>
          ) : (
            versions.map((v) => (
              <div
                key={v.id}
                className="rounded border border-white/15 bg-white/10 dark:bg-black/20 p-3 font-mono text-xs"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400 font-bold">
                      v{v.versionNumber}
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[8px] px-1.5 py-0 border-white/15 text-muted-foreground bg-transparent"
                    >
                      {triggerLabels[v.trigger] || v.trigger}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-muted-foreground hover:text-foreground hover:bg-white/10"
                    onClick={() => handleRestore(v)}
                    disabled={restoring === v.id}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    RESTORE
                  </Button>
                </div>

                <div className="flex items-center gap-3 text-muted-foreground/60">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatTimestamp(v.timestamp)}
                  </span>
                  <span className="flex items-center gap-1">
                    {v.device === 'mobile' ? (
                      <Smartphone className="h-3 w-3" />
                    ) : (
                      <Monitor className="h-3 w-3" />
                    )}
                    {v.device}
                  </span>
                  <span className="flex items-center gap-1">
                    <Shield className="h-3 w-3" />
                    {v.fieldCount} fields
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
