import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Save, LogOut, X, AlertTriangle } from "lucide-react";

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
      <AlertDialogContent className="bg-slate-900/95 backdrop-blur-xl border border-white/20 shadow-2xl max-w-sm rounded-none sm:rounded-none">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg flex items-center gap-2 text-white font-bold tracking-tight">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            Unsaved Changes Detected
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-300">
            You have unsaved progress in this report. Do you want to{" "}
            <span className="font-semibold text-white">Save and Exit</span> or{" "}
            <span className="font-semibold text-white">Discard Changes and Exit</span>?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={onSave}
            disabled={isSaving}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-white border-0 rounded-none font-semibold"
          >
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? "Saving…" : "Save & Exit"}
          </Button>
          <Button
            variant="destructive"
            onClick={onLeave}
            disabled={isSaving}
            className="w-full rounded-none font-semibold"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Discard & Exit
          </Button>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isSaving}
            className="w-full rounded-none border-white/20 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="w-4 h-4 mr-2" />
            Stay on Page
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
