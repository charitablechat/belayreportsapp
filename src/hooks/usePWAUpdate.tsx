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

  // Re-check for waiting SW on BFCache restore or tab switch (iPad/Safari fix)
  useEffect(() => {
    const recheckWaiting = () => {
      if (registration?.waiting) setNeedRefresh(true);
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) recheckWaiting();
    };
    const onVisChange = () => {
      if (document.visibilityState === 'visible') recheckWaiting();
    };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisChange);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [registration]);

  const checkForUpdates = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return;
    setIsChecking(true);
    try {
      const reg = registration || await navigator.serviceWorker.ready;

      // Already waiting? Done.
      if (reg.waiting) {
        setNeedRefresh(true);
        return;
      }

      // Listen for updatefound BEFORE calling update()
      const updatePromise = new Promise<boolean>((resolve) => {
        const onUpdateFound = () => {
          reg.removeEventListener('updatefound', onUpdateFound);
          const sw = reg.installing;
          if (!sw) { resolve(false); return; }

          const onStateChange = () => {
            if (sw.state === 'installed' || sw.state === 'activated') {
              sw.removeEventListener('statechange', onStateChange);
              resolve(true);
            }
          };
          sw.addEventListener('statechange', onStateChange);
          if (sw.state === 'installed' || sw.state === 'activated') {
            sw.removeEventListener('statechange', onStateChange);
            resolve(true);
          }
        };
        reg.addEventListener('updatefound', onUpdateFound);

        // Safety: resolve false after 8s if no update found
        setTimeout(() => {
          reg.removeEventListener('updatefound', onUpdateFound);
          resolve(false);
        }, 8000);
      });

      await reg.update();

      // Check immediately after update() in case waiting was set synchronously
      if (reg.waiting) {
        setNeedRefresh(true);
        return;
      }

      const found = await updatePromise;
      if (found || reg.waiting) {
        setNeedRefresh(true);
      }
    } catch (error) {
      console.error('[PWA Update] Check failed:', error);
    } finally {
      const now = new Date();
      setLastChecked(now);
      localStorage.setItem('pwa-last-update-check', now.toISOString());
      setIsChecking(false);
    }
  }, [registration]);

  const updateServiceWorker = useCallback(async (reloadPage = true) => {
    if (registration?.waiting) {
      console.log('[PWA Update] Activating waiting service worker');

      if (reloadPage) {
        localStorage.setItem(UPDATE_APPLIED_KEY, 'true');
      }

      setNeedRefresh(false);

      if (reloadPage) {
        const reloadOnce = () => {
          navigator.serviceWorker.removeEventListener('controllerchange', reloadOnce);
          window.location.reload();
        };
        navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);

        setTimeout(() => {
          navigator.serviceWorker.removeEventListener('controllerchange', reloadOnce);
          window.location.reload();
        }, 3000);
      }

      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      console.log('[PWA Update] No waiting service worker found');
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
