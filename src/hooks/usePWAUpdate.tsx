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
        
        // Check if there's already an update waiting
        if (reg.waiting) {
          setNeedRefresh(true);
          if (import.meta.env.DEV) {
            console.log('[PWA Update] Update already waiting');
          }
        }
        
        // Set offline ready
        if (!offlineReady) {
          setOfflineReady(true);
        }

        // Check for updates every hour
        const intervalId = setInterval(() => {
          if (import.meta.env.DEV) {
            console.log('[PWA Update] Auto-checking for updates...');
          }
          reg.update();
        }, 60 * 60 * 1000); // 1 hour

        return () => clearInterval(intervalId);
      }).catch((error) => {
        if (import.meta.env.DEV) {
          console.error('[PWA Update] Service Worker registration error:', error);
        }
      });

      // Listen for new service worker waiting to activate
      const handleControllerChange = () => {
        if (import.meta.env.DEV) {
          console.log('[PWA Update] New service worker activated');
        }
        window.location.reload();
      };

      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

      // Listen for updatefound events
      navigator.serviceWorker.ready.then((reg) => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                setNeedRefresh(true);
                if (import.meta.env.DEV) {
                  console.log('[PWA Update] New version available');
                }
              }
            });
          }
        });
      });

      return () => {
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      };
    }
  }, [offlineReady]);

  const updateServiceWorker = async (reloadPage = true) => {
    if (registration?.waiting) {
      console.log('[PWA Update] Activating new service worker');
      
      // Tell the waiting service worker to skip waiting
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      
      // Retry after a short delay if controller doesn't change
      setTimeout(() => {
        if (registration?.waiting) {
          console.log('[PWA Update] Retrying SKIP_WAITING');
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }, 1000);
      
      if (reloadPage) {
        // Small delay to allow SW activation before reload
        setTimeout(() => window.location.reload(), 500);
      }
    } else {
      console.log('[PWA Update] No waiting service worker found');
    }
  };

  return {
    needRefresh,
    offlineReady,
    updateServiceWorker,
  };
};
