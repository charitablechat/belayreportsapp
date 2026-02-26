import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LocalSnapshotsPanel, CloudSnapshotsPanel, RecoveryErrorBoundary } from "@/components/admin/DataRecoveryTool";
import { ScrollArea } from "@/components/ui/scroll-area";

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
          <div className="space-y-6 pt-2">
            <RecoveryErrorBoundary panelName="Local Backup Snapshots">
              <LocalSnapshotsPanel allowDelete={false} />
            </RecoveryErrorBoundary>
            <RecoveryErrorBoundary panelName="Cloud Backup Snapshots">
              <CloudSnapshotsPanel allowDelete={false} />
            </RecoveryErrorBoundary>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}