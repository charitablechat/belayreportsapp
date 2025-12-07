import { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { usePWA } from '@/hooks/usePWA';

export const UpdateNotification = () => {
  const { needsUpdate, offlineReady, updateAndReload } = usePWA();
  const hasShownUpdate = useRef(false);
  const hasShownOfflineReady = useRef(false);

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
