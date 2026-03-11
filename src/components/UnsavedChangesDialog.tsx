import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Save, LogOut, X } from "lucide-react";

interface UnsavedChangesDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onSaveAndLeave?: () => void;
  message?: string;
  hasUnsavedChanges?: boolean;
}

export function UnsavedChangesDialog({
  isOpen,
  onConfirm,
  onCancel,
  onSaveAndLeave,
  message,
  hasUnsavedChanges = true,
}: UnsavedChangesDialogProps) {
  const displayMessage = hasUnsavedChanges
    ? (message || "You have unsaved progress in this report. Do you want to Save and Exit or Discard Changes and Exit?")
    : "Are you sure you want to leave this report?";

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="bg-slate-900/95 backdrop-blur-xl border border-white/20 shadow-2xl max-w-sm rounded-none sm:rounded-none">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg flex items-center gap-2 text-white font-bold tracking-tight">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            {hasUnsavedChanges ? "Unsaved Changes Detected" : "Leaving Report"}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-300">
            {displayMessage}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          {hasUnsavedChanges && onSaveAndLeave && (
            <Button
              onClick={onSaveAndLeave}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-white border-0 rounded-none font-semibold"
            >
              <Save className="w-4 h-4 mr-2" />
              Save & Exit
            </Button>
          )}
          <Button
            variant="destructive"
            onClick={onConfirm}
            className="w-full rounded-none font-semibold"
          >
            <LogOut className="w-4 h-4 mr-2" />
            {hasUnsavedChanges ? "Exit — Nothing to Save" : "Exit Report"}
          </Button>
          <Button
            variant="outline"
            onClick={onCancel}
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
