import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Lock } from "lucide-react";

interface CompletionLockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function CompletionLockDialog({ open, onOpenChange, onConfirm }: CompletionLockDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-black border-2 border-amber-500 font-mono max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-amber-400 flex items-center gap-2 text-lg tracking-wide">
            <Lock className="h-5 w-5" />
            REPORT LOCKED
          </AlertDialogTitle>
          <AlertDialogDescription className="text-gray-300 font-mono text-sm leading-relaxed">
            This report has been completed. Editing will reopen it for modifications. Proceed?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="border-2 border-amber-500/60 bg-transparent text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 font-mono">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-amber-500 text-black hover:bg-amber-400 font-mono font-bold border-2 border-amber-500"
          >
            Unlock &amp; Edit
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
