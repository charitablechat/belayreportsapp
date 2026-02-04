import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { X } from "lucide-react";

interface VersionInfoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VersionInfoModal({ open, onOpenChange }: VersionInfoModalProps) {
  const version = import.meta.env.APP_VERSION || '0.0.0';
  const buildDate = import.meta.env.BUILD_DATE || 'Unknown';
  const buildTimestamp = import.meta.env.BUILD_TIMESTAMP || 'Unknown';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        hideDefaultClose
        className="bg-black border-2 border-white rounded-none shadow-none max-w-sm"
      >
        {/* Custom brutalist close button */}
        <DialogClose className="absolute right-3 top-3 p-1 border border-white/50 hover:border-white hover:bg-white/10 transition-colors">
          <X className="h-4 w-4 text-white" />
          <span className="sr-only">Close</span>
        </DialogClose>

        <DialogHeader>
          <DialogTitle className="font-mono text-xs uppercase tracking-widest text-amber-500">
            Version Info
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Version Number - Hero Display */}
          <div className="text-center py-4">
            <span className="font-mono text-4xl font-bold text-white tracking-tight">
              v{version}
            </span>
          </div>

          <div className="border-t border-white/20" />

          {/* Last Update Date */}
          <div className="space-y-1">
            <span className="font-mono text-xs uppercase tracking-widest text-amber-500 block">
              Last Update
            </span>
            <span className="font-mono text-sm text-white block">
              {buildDate}
            </span>
          </div>

          {/* Build Timestamp */}
          <div className="space-y-1">
            <span className="font-mono text-xs uppercase tracking-widest text-amber-500 block">
              Build Timestamp
            </span>
            <span className="font-mono text-sm text-white block">
              {buildTimestamp}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
