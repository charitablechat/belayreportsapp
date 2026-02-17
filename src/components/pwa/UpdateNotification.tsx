import { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { usePWA } from '@/hooks/usePWA';

export const UpdateNotification = () => {
  const { needsUpdate, offlineReady, updateAndReload } = usePWA();
  const hasShownUpdate = useRef(false);
  const hasShownOfflineReady = useRef(false);

  // Auto-reload when new SW takes control to bust stale cached version strings
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const handleControllerChange = () => {
        window.location.reload();
      };
      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
      return () => {
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      };
    }
  }, []);

  useEffect(() => {
    if (needsUpdate && !hasShownUpdate.current) {
      hasShownUpdate.current = true;
      
      if (import.meta.env.DEV) {
        console.log('[Update Notification] Showing update available notification');
      }

      toast.success('Update Available', {
        description: 'A new version of the app is available',
        duration: 60000,
        id: 'update-available',
        action: {
          label: 'Update Now',
          onClick: () => {
            if (import.meta.env.DEV) {
              console.log('[Update Notification] User clicked update button');
            }
            toast.dismiss('update-available');
            updateAndReload();
          },
        },
        icon: <RefreshCw className="w-4 h-4" />,
      });
    }
  }, [needsUpdate, updateAndReload]);

  // Removed offline ready toast notification as per user request

  return null;
};
