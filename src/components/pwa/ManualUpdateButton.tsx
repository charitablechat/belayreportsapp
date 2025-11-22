import { useState } from 'react';
import { RefreshCw, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePWA } from '@/hooks/usePWA';
import { toast } from 'sonner';
import { isMobile } from '@/lib/mobile-detection';

export const ManualUpdateButton = () => {
  const { needsUpdate, updateAndReload } = usePWA();
  const [checking, setChecking] = useState(false);

  const handleCheckForUpdates = async () => {
    if (needsUpdate) {
      // Update is already available
      updateAndReload();
      return;
    }

    setChecking(true);
    
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.update();
        
        // Wait a bit to see if an update was found
        setTimeout(() => {
          if (!needsUpdate) {
            toast.success('App is up to date', {
              description: 'You\'re running the latest version',
            });
          }
          setChecking(false);
        }, 1000);
      }
    } catch (error) {
      console.error('[Manual Update] Error checking for updates:', error);
      toast.error('Failed to check for updates');
      setChecking(false);
    }
  };

  // Only show on mobile
  if (!isMobile()) return null;

  return (
    <Button
      variant={needsUpdate ? "default" : "outline"}
      size="sm"
      onClick={handleCheckForUpdates}
      disabled={checking}
      className="gap-2"
    >
      {needsUpdate ? (
        <>
          <RefreshCw className="w-4 h-4" />
          <span className="hidden sm:inline">Update App</span>
        </>
      ) : (
        <>
          <Smartphone className={`w-4 h-4 ${checking ? 'animate-pulse' : ''}`} />
          <span className="hidden sm:inline">Check Updates</span>
        </>
      )}
    </Button>
  );
};
