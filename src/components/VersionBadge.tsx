import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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
        <Badge 
          variant="outline" 
          className="text-xs font-mono text-muted-foreground/60 border-muted-foreground/20 px-3 py-1 cursor-pointer hover:text-muted-foreground hover:border-muted-foreground/40 transition-colors"
          onClick={() => setModalOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setModalOpen(true);
            }
          }}
        >
          v{version}
        </Badge>
      </div>

      <VersionInfoModal 
        open={modalOpen} 
        onOpenChange={setModalOpen} 
      />
    </>
  );
}
