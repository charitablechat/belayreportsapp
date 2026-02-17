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
      <AlertDialogContent className="bg-black border-double border-4 border-green-500 font-mono max-w-md relative overflow-hidden">
        {/* CRT scanline overlay */}
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{
            background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,0,0.03) 2px, rgba(0,255,0,0.03) 4px)',
          }}
        />
        <AlertDialogHeader>
          <AlertDialogTitle className="text-green-500 flex items-center gap-2 text-lg tracking-wide">
            <Lock className="h-5 w-5" />
            REPORT LOCKED
          </AlertDialogTitle>
          <AlertDialogDescription className="text-green-400/80 font-mono text-sm leading-relaxed">
            This report has been completed. Editing will reopen it for modifications. Proceed?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="border-2 border-green-500/60 bg-transparent text-green-500 hover:bg-green-500/10 hover:text-green-400 font-mono">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-green-500 text-black hover:bg-green-400 font-mono font-bold border-2 border-green-500"
          >
            Confirm Edit
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
