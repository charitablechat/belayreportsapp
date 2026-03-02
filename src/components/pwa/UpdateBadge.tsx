import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { usePWA } from '@/hooks/usePWA';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { UpdateControlPanel } from './UpdateControlPanel';

export const UpdateBadge = () => {
  const { needsUpdate, isCheckingForUpdate } = usePWA();
  const [panelOpen, setPanelOpen] = useState(false);

  // Hide entirely when no update and not checking
  if (!needsUpdate && !isCheckingForUpdate) return null;

  return (
    <>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setPanelOpen(true)}
              className="relative flex items-center justify-center w-7 h-7 border border-white/30 bg-black/80 backdrop-blur-md transition-all duration-200 hover:bg-black/90 hover:border-white/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400"
              aria-label={needsUpdate ? 'Update available' : 'Checking for updates'}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  isCheckingForUpdate
                    ? 'animate-spin text-blue-400'
                    : 'text-amber-400'
                }`}
              />
              {needsUpdate && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="font-mono text-xs bg-black/90 text-amber-400 border border-white/20 rounded-none px-2 py-1"
          >
            {isCheckingForUpdate ? 'CHECKING...' : 'UPDATE AVAILABLE'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <UpdateControlPanel open={panelOpen} onOpenChange={setPanelOpen} />
    </>
  );
};
