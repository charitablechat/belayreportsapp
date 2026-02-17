import { useState } from "react";
import { VersionInfoModal } from "@/components/VersionInfoModal";

interface VersionBadgeProps {
  compact?: boolean;
}

export function VersionBadge({ compact = false }: VersionBadgeProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const version = import.meta.env.APP_VERSION || '0.0.0';
  
  return (
    <>
      <div className={compact ? "flex justify-center py-2" : "flex justify-center py-6"}>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="
            font-mono text-xs px-3 py-1 rounded-sm
            border border-zinc-700 text-zinc-500
            bg-transparent
            transition-all duration-300
            hover:text-green-400 hover:border-green-500/50
            hover:shadow-[0_0_8px_rgba(34,197,94,0.3)]
            focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-green-500/50
            relative overflow-hidden
          "
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, rgba(34,197,94,0.04) 0px, rgba(34,197,94,0.04) 1px, transparent 1px, transparent 3px)',
          }}
        >
          v{version}
        </button>
      </div>

      <VersionInfoModal 
        open={modalOpen} 
        onOpenChange={setModalOpen} 
      />
    </>
  );
}
