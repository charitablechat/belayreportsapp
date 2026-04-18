import { useState } from "react";
import { VersionInfoModal } from "@/components/VersionInfoModal";
import { useVersionStatus } from "@/hooks/useVersionStatus";

interface VersionBadgeProps {
  compact?: boolean;
}

export function VersionBadge({ compact = false }: VersionBadgeProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const { installed, updateAvailable } = useVersionStatus();

  return (
    <>
      <div className={compact ? "flex justify-center py-2" : "flex justify-center py-6"}>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="
            font-sans text-xs px-3 py-1 rounded-md
            border border-white/20 text-muted-foreground
            bg-white/10 backdrop-blur-md
            transition-all duration-300
            hover:bg-white/20 hover:text-foreground hover:border-white/30
            hover:shadow-lg
            focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50
            relative overflow-hidden
            inline-flex items-center gap-1.5
          "
        >
          <span
            aria-hidden
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              updateAvailable ? "bg-amber-500 animate-pulse" : "bg-emerald-500"
            }`}
          />
          v{installed}
        </button>
      </div>

      <VersionInfoModal
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </>
  );
}
