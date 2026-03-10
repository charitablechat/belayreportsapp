import { lazy, Suspense } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";

const LazyLocalSnapshotsPanel = lazy(() =>
  import("@/components/admin/DataRecoveryTool").then(m => ({ default: m.LocalSnapshotsPanel }))
);
const LazyCloudSnapshotsPanel = lazy(() =>
  import("@/components/admin/DataRecoveryTool").then(m => ({ default: m.CloudSnapshotsPanel }))
);
const LazyRecoveryErrorBoundary = lazy(() =>
  import("@/components/admin/DataRecoveryTool").then(m => ({ default: m.RecoveryErrorBoundary }))
);

interface UserDataRecoverySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserDataRecoverySheet({ open, onOpenChange }: UserDataRecoverySheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] p-0 overflow-hidden backdrop-blur-xl bg-background/95 dark:bg-slate-950/95 border-t border-white/10">
        <SheetHeader className="px-3 sm:px-6 pt-6 pb-2">
          <SheetTitle className="text-foreground font-black tracking-tight">Data Recovery</SheetTitle>
          <SheetDescription className="text-muted-foreground/70">
            View and restore local and cloud backups stored on this device. Only restore actions are available.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(85vh-120px)] px-2 sm:px-6 pb-6 [&>div]:!overflow-x-hidden">
          <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
            <div className="space-y-6 pt-2">
              <LazyRecoveryErrorBoundary panelName="Local Backup Snapshots">
                <LazyLocalSnapshotsPanel allowDelete={true} />
              </LazyRecoveryErrorBoundary>
              <LazyRecoveryErrorBoundary panelName="Cloud Backup Snapshots">
                <LazyCloudSnapshotsPanel allowDelete={true} />
              </LazyRecoveryErrorBoundary>
            </div>
          </Suspense>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}