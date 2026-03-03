import { useState } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { usePWA } from '@/hooks/usePWA';

export const UpdateNotification = () => {
  const { needsUpdate, updateAndReload } = usePWA();
  const [dismissed, setDismissed] = useState(false);

  if (!needsUpdate || dismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-foreground text-background font-mono text-sm flex items-center justify-between px-4 py-2 shadow-lg">
      <span className="tracking-wide">
        UPDATE AVAILABLE
      </span>
      <div className="flex items-center gap-3">
        <button
          onClick={() => updateAndReload()}
          className="flex items-center gap-1.5 bg-amber-500 text-black px-3 py-1 font-mono text-xs font-bold tracking-wider hover:bg-amber-400 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          INSTALL UPDATE
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-background/60 hover:text-background transition-colors"
          aria-label="Dismiss update notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
