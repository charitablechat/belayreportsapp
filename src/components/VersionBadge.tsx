import { useState } from "react";
import { VersionInfoModal } from "@/components/VersionInfoModal";
import { useVersionStatus } from "@/hooks/useVersionStatus";
import { isPreviewOrIframeEnvironment } from "@/lib/environment";

interface VersionBadgeProps {
  compact?: boolean;
}

export function VersionBadge({ compact = false }: VersionBadgeProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const { installed, deployed, updateAvailable } = useVersionStatus();

  // In the Lovable preview the local bundle version is always one (or more)
  // patch bumps behind production because the auto-bump in vite-auto-version.ts
  // only runs on production builds. To avoid confusion ("why does the editor
  // say v4.8.0 when rwreports.com says v4.8.1?"), the preview badge shows the
  // deployed version as the primary number with the preview build version as
  // a small sub-line. Production rendering is unchanged.
  const isPreview = isPreviewOrIframeEnvironment();
  const primary = isPreview && deployed ? deployed : installed;
  const showPreviewSub = isPreview && deployed && deployed !== installed;

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
            inline-flex flex-col items-center gap-0.5
          "
        >
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                updateAvailable ? "bg-amber-500 animate-pulse" : "bg-emerald-500"
              }`}
            />
            v{primary}
          </span>
          {showPreviewSub && (
            <span className="text-[10px] leading-none opacity-70">
              preview build v{installed}
            </span>
          )}
        </button>
      </div>

      <VersionInfoModal
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </>
  );
}
