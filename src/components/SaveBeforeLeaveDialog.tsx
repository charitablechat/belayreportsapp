import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Save, LogOut, X } from "lucide-react";

interface SaveBeforeLeaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  onLeave: () => void;
  onCancel: () => void;
  isSaving?: boolean;
}

export function SaveBeforeLeaveDialog({
  open,
  onOpenChange,
  onSave,
  onLeave,
  onCancel,
  isSaving = false,
}: SaveBeforeLeaveDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-card/95 backdrop-blur-md border-border/60 shadow-xl max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg">Save before leaving?</AlertDialogTitle>
          <AlertDialogDescription>
            Would you like to save your report before going back?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={onSave} disabled={isSaving} className="w-full">
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? "Saving…" : "Save & Leave"}
          </Button>
          <Button variant="destructive" onClick={onLeave} disabled={isSaving} className="w-full">
            <LogOut className="w-4 h-4 mr-2" />
            Leave Without Saving
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={isSaving} className="w-full">
            <X className="w-4 h-4 mr-2" />
            Stay on Page
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
