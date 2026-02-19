import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LocalSnapshotsPanel, IndexedDBRecoveryPanel } from "@/components/admin/DataRecoveryTool";
import { ScrollArea } from "@/components/ui/scroll-area";

interface UserDataRecoverySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserDataRecoverySheet({ open, onOpenChange }: UserDataRecoverySheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] p-0">
        <SheetHeader className="px-6 pt-6 pb-2">
          <SheetTitle>Data Recovery</SheetTitle>
          <SheetDescription>
            View and restore local backups stored on this device. Only restore actions are available.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(85vh-100px)] px-6 pb-6">
          <div className="space-y-6 pt-2">
            <LocalSnapshotsPanel allowDelete={false} />
            <IndexedDBRecoveryPanel allowDelete={false} />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
