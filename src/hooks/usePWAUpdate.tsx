import { useState, useEffect, useCallback, useRef } from 'react';

export interface PWAUpdateStatus {
  needRefresh: boolean;
  offlineReady: boolean;
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
  lastChecked: Date | null;
  isChecking: boolean;
  checkForUpdates: () => Promise<void>;
}

export const usePWAUpdate = (): PWAUpdateStatus => {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(() => {
    const stored = localStorage.getItem('pwa-last-update-check');
    return stored ? new Date(stored) : null;
  });
  const [isChecking, setIsChecking] = useState(false);
  const offlineReadyRef = useRef(offlineReady);
  offlineReadyRef.current = offlineReady;

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('SW timeout')), 5000)
        )
      ]).then((reg: ServiceWorkerRegistration) => {
        if (import.meta.env.DEV) {
          console.log('[PWA Update] Service Worker ready');
        }
        setRegistration(reg);
        
        if (reg.waiting) {
          setNeedRefresh(true);
          if (import.meta.env.DEV) {
            console.log('[PWA Update] Update already waiting');
          }
        }
        
        if (!offlineReadyRef.current) {
          setOfflineReady(true);
        }

        const intervalId = setInterval(() => {
          if (import.meta.env.DEV) {
            console.log('[PWA Update] Auto-checking for updates...');
          }
          reg.update();
          const now = new Date();
          setLastChecked(now);
          localStorage.setItem('pwa-last-update-check', now.toISOString());
        }, 60 * 60 * 1000);

        return () => clearInterval(intervalId);
      }).catch(() => {
        // SW unavailable in this environment
      });

      const handleControllerChange = () => {
        if (import.meta.env.DEV) {
          console.log('[PWA Update] New service worker activated — flagging for user-initiated reload');
        }
        setNeedRefresh(true);
      };

      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

      Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('SW timeout')), 5000)
        )
      ]).then((reg: ServiceWorkerRegistration) => {
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
      }).catch(() => {
        // SW unavailable
      });

      return () => {
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      };
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    setIsChecking(true);
    try {
      if ('serviceWorker' in navigator) {
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('SW not available')), 5000)
          )
        ]) as ServiceWorkerRegistration;
        await reg.update();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        if (reg.waiting || reg.installing) {
          setNeedRefresh(true);
        }
      }
    } catch (error) {
      console.error('[PWA Update] Manual check failed:', error);
    } finally {
      const now = new Date();
      setLastChecked(now);
      localStorage.setItem('pwa-last-update-check', now.toISOString());
      setIsChecking(false);
    }
  }, []);

  const updateServiceWorker = async (reloadPage = true) => {
    if (registration?.waiting) {
      console.log('[PWA Update] Activating new service worker');
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      
      setTimeout(() => {
        if (registration?.waiting) {
          console.log('[PWA Update] Retrying SKIP_WAITING');
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }, 1000);
      
      if (reloadPage) {
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
    lastChecked,
    isChecking,
    checkForUpdates,
  };
};
