import { useState, useEffect, useCallback, useRef } from 'react';

export interface PWAUpdateStatus {
  needRefresh: boolean;
  offlineReady: boolean;
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
  lastChecked: Date | null;
  isChecking: boolean;
  checkForUpdates: () => Promise<void>;
}

const UPDATE_APPLIED_KEY = 'pwa-update-just-applied';

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

  // On mount, suppress banner if we just applied an update before reload
  useEffect(() => {
    if (localStorage.getItem(UPDATE_APPLIED_KEY)) {
      localStorage.removeItem(UPDATE_APPLIED_KEY);
      // Don't set needRefresh — the update is already active
    }
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let intervalId: ReturnType<typeof setInterval>;

    const swReady = Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('SW timeout')), 5000)
      )
    ]) as Promise<ServiceWorkerRegistration>;

    swReady.then((reg) => {
      if (import.meta.env.DEV) {
        console.log('[PWA Update] Service Worker ready');
      }
      setRegistration(reg);

      // Check if a new SW is already waiting
      if (reg.waiting) {
        setNeedRefresh(true);
        if (import.meta.env.DEV) {
          console.log('[PWA Update] Update already waiting');
        }
      }

      if (!offlineReadyRef.current) {
        setOfflineReady(true);
      }

      // Listen for future updates
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              setNeedRefresh(true);
              if (import.meta.env.DEV) {
                console.log('[PWA Update] New version available (waiting)');
              }
            }
          });
        }
      });

      // Hourly auto-check
      intervalId = setInterval(() => {
        if (import.meta.env.DEV) {
          console.log('[PWA Update] Auto-checking for updates...');
        }
        reg.update();
        const now = new Date();
        setLastChecked(now);
        localStorage.setItem('pwa-last-update-check', now.toISOString());
      }, 60 * 60 * 1000);
    }).catch(() => {
      // SW unavailable
    });

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const checkForUpdates = useCallback(async () => {
    setIsChecking(true);
    try {
      if ('serviceWorker' in navigator) {
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<never>((_, reject) =>
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

  const updateServiceWorker = useCallback(async (reloadPage = true) => {
    if (registration?.waiting) {
      console.log('[PWA Update] Activating waiting service worker');

      // Mark that we're applying an update so post-reload doesn't re-show the banner
      if (reloadPage) {
        localStorage.setItem(UPDATE_APPLIED_KEY, 'true');
      }

      // Clear banner immediately
      setNeedRefresh(false);

      // Listen for the new SW to take control, then reload
      if (reloadPage) {
        const reloadOnce = () => {
          navigator.serviceWorker.removeEventListener('controllerchange', reloadOnce);
          window.location.reload();
        };
        navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);

        // Safety timeout — reload anyway after 3s if controllerchange doesn't fire
        setTimeout(() => {
          navigator.serviceWorker.removeEventListener('controllerchange', reloadOnce);
          window.location.reload();
        }, 3000);
      }

      // Tell the waiting SW to activate
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      console.log('[PWA Update] No waiting service worker found');
      // If needRefresh was set by controllerchange (SW already active), just reload
      if (needRefresh && reloadPage) {
        localStorage.setItem(UPDATE_APPLIED_KEY, 'true');
        setNeedRefresh(false);
        window.location.reload();
      }
    }
  }, [registration, needRefresh]);

  return {
    needRefresh,
    offlineReady,
    updateServiceWorker,
    lastChecked,
    isChecking,
    checkForUpdates,
  };
};
