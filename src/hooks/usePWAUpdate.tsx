import { useState, useEffect } from 'react';

export interface PWAUpdateStatus {
  needRefresh: boolean;
  offlineReady: boolean;
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
}

export const usePWAUpdate = (): PWAUpdateStatus => {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      // Get the service worker registration
      navigator.serviceWorker.ready.then((reg) => {
        if (import.meta.env.DEV) {
          console.log('[PWA Update] Service Worker ready');
        }
        setRegistration(reg);
        
        // Only set offline ready once
        if (!offlineReady) {
          setOfflineReady(true);
        }

        // Check for updates every hour
        setInterval(() => {
          if (import.meta.env.DEV) {
            console.log('[PWA Update] Checking for updates...');
          }
          reg.update();
        }, 60 * 60 * 1000); // 1 hour
      }).catch((error) => {
        if (import.meta.env.DEV) {
          console.error('[PWA Update] Service Worker registration error:', error);
        }
      });
    }
  }, [offlineReady]);

  const updateServiceWorker = async (reloadPage = true) => {
    if (registration?.waiting) {
      if (import.meta.env.DEV) {
        console.log('[PWA Update] Activating new service worker');
      }
      // Tell the waiting service worker to skip waiting
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      
      if (reloadPage) {
        window.location.reload();
      }
    }
  };

  return {
    needRefresh,
    offlineReady,
    updateServiceWorker,
  };
};
