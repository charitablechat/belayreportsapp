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
            font-sans text-xs px-3 py-1 rounded-md
            border border-white/20 text-muted-foreground
            bg-white/10 backdrop-blur-md
            transition-all duration-300
            hover:bg-white/20 hover:text-foreground hover:border-white/30
            hover:shadow-lg
            focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50
            relative overflow-hidden
          "
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
