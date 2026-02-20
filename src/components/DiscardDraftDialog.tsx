import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface DiscardDraftDialogProps {
  open: boolean;
  onStay: () => void;
  onDiscard: () => void;
}

export function DiscardDraftDialog({ open, onStay, onDiscard }: DiscardDraftDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onStay(); }}>
      <AlertDialogContent className="bg-slate-900/95 backdrop-blur-xl border border-white/20 shadow-2xl max-w-sm">
        <AlertDialogHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-amber-400/15 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <AlertDialogTitle className="text-white text-lg font-semibold leading-tight">
              Discard Unsaved Changes?
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-slate-300 text-sm leading-relaxed pl-12">
            Any information you've entered will be lost if you go back now.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex flex-col gap-2 sm:flex-col mt-2">
          <Button
            onClick={onStay}
            className="w-full bg-slate-700 hover:bg-slate-600 text-white border border-white/10"
          >
            Stay on Page
          </Button>
          <Button
            variant="outline"
            onClick={onDiscard}
            className="w-full border-white/20 text-slate-300 hover:text-white hover:bg-red-500/20 hover:border-red-400/40"
          >
            Discard &amp; Go Back
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
