import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { X, ArrowUpCircle, CheckCircle2 } from "lucide-react";
import { useVersionStatus } from "@/hooks/useVersionStatus";

interface VersionInfoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VersionInfoModal({ open, onOpenChange }: VersionInfoModalProps) {
  const buildDate = (import.meta.env.BUILD_DATE as string) || 'Unknown';
  const buildTimestamp = (import.meta.env.BUILD_TIMESTAMP as string) || 'Unknown';
  const { installed, deployed, updateAvailable, environment } = useVersionStatus({ forceOnMount: open });

  const envLabel = environment === 'preview' ? 'PREVIEW' : environment === 'published' ? 'PUBLISHED' : 'LOCAL';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideDefaultClose
        className="bg-black/90 backdrop-blur-xl border border-white/20 rounded-lg shadow-2xl max-w-sm overflow-hidden"
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
          <DialogTitle className="font-mono text-xs uppercase tracking-widest text-amber-500 flex items-center gap-2">
            Version Info
            <span className="font-mono text-[10px] px-1.5 py-0.5 border border-white/30 text-white/80">
              {envLabel}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4 relative z-10">
          {/* Installed Version - Hero */}
          <div className="text-center py-2">
            <div className="font-mono text-[10px] uppercase tracking-widest text-amber-500 mb-1">Installed</div>
            <span
              className="font-mono text-4xl font-bold text-white tracking-tight"
              style={{ textShadow: '0 0 10px rgba(34,197,94,0.3)' }}
            >
              v{installed}
            </span>
          </div>

          {/* Deployed comparison */}
          <div className="border border-white/20 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-amber-500">Deployed</span>
              {deployed ? (
                updateAvailable ? (
                  <span className="flex items-center gap-1 text-amber-400 font-mono text-[10px] uppercase">
                    <ArrowUpCircle className="h-3 w-3" /> Update Available
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-emerald-400 font-mono text-[10px] uppercase">
                    <CheckCircle2 className="h-3 w-3" /> Current
                  </span>
                )
              ) : (
                <span className="font-mono text-[10px] text-white/40 uppercase">Checking…</span>
              )}
            </div>
            <span className="font-mono text-sm text-white block">
              {deployed ? `v${deployed}` : '—'}
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
