import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { usePWAUpdate } from '@/hooks/usePWAUpdate';
import { Button } from '@/components/ui/button';

export const UpdateNotification = () => {
  const { needRefresh, offlineReady, updateServiceWorker } = usePWAUpdate();

  useEffect(() => {
    if (needRefresh) {
      if (import.meta.env.DEV) {
        console.log('[Update Notification] Showing update available notification');
      }

      toast.success('Update Available', {
        description: 'A new version of the app is available',
        duration: Infinity,
        id: 'update-available',
        action: {
          label: 'Update Now',
          onClick: () => {
            if (import.meta.env.DEV) {
              console.log('[Update Notification] User clicked update button');
            }
            updateServiceWorker(true);
          },
        },
        icon: <RefreshCw className="w-4 h-4" />,
      });
    }
  }, [needRefresh, updateServiceWorker]);

  useEffect(() => {
    if (offlineReady) {
      if (import.meta.env.DEV) {
        console.log('[Update Notification] App ready for offline use');
      }

      toast.success('Ready for Offline Use', {
        description: 'The app is now available offline',
        icon: <RefreshCw className="w-4 h-4" />,
      });
    }
  }, [offlineReady]);

  return null;
};
