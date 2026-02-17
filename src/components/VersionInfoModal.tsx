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
        className="bg-black border-2 border-white rounded-none shadow-none max-w-sm overflow-hidden"
      >
        {/* CRT scanline overlay */}
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, rgba(34,197,94,0.06) 0px, rgba(34,197,94,0.06) 1px, transparent 1px, transparent 3px)',
          }}
        />

        {/* Custom brutalist close button */}
        <DialogClose className="absolute right-3 top-3 p-1 border border-white/50 hover:border-white hover:bg-white/10 transition-colors z-20">
          <X className="h-4 w-4 text-white" />
          <span className="sr-only">Close</span>
        </DialogClose>

        <DialogHeader>
          <DialogTitle className="font-mono text-xs uppercase tracking-widest text-amber-500">
            Version Info
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4 relative z-10">
          {/* Version Number - Hero Display */}
          <div className="text-center py-4">
            <span
              className="font-mono text-4xl font-bold text-white tracking-tight"
              style={{ textShadow: '0 0 10px rgba(34,197,94,0.3)' }}
            >
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
