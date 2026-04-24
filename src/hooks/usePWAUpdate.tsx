import { useState, useEffect, useCallback, useRef } from 'react';
import { isPreviewOrIframeEnvironment } from '@/lib/environment';
import { safeSetItem } from '@/lib/safe-local-storage';

export type UpdateCheckResult = 'update_found' | 'up_to_date' | 'no_sw' | 'error';

export interface PWAUpdateStatus {
  needRefresh: boolean;
  offlineReady: boolean;
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
  lastChecked: Date | null;
  isChecking: boolean;
  checkForUpdates: () => Promise<UpdateCheckResult>;
}

const UPDATE_APPLIED_KEY = 'pwa-update-just-applied';
const SW_READY_TIMEOUT_MS = 3000;
const SW_UPDATE_TIMEOUT_MS = 4000;

const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    ),
  ]);

const getAvailableServiceWorkerRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!('serviceWorker' in navigator) || isPreviewOrIframeEnvironment()) {
    return null;
  }

  try {
    const existingRegistration = await navigator.serviceWorker.getRegistration();
    if (existingRegistration) {
      return existingRegistration;
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[PWA Update] Failed to inspect service worker registration:', error);
    }
  }

  try {
    return await withTimeout(navigator.serviceWorker.ready, SW_READY_TIMEOUT_MS, 'SW ready');
  } catch {
    return null;
  }
};

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
    }
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || isPreviewOrIframeEnvironment()) return;

    let intervalId: ReturnType<typeof setInterval> | undefined;

    getAvailableServiceWorkerRegistration()
      .then((reg) => {
        if (!reg) return;

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

        intervalId = setInterval(() => {
          if (import.meta.env.DEV) {
            console.log('[PWA Update] Auto-checking for updates...');
          }

          void withTimeout(reg.update(), SW_UPDATE_TIMEOUT_MS, 'SW update (auto)').catch((error) => {
            if (import.meta.env.DEV) {
              console.warn('[PWA Update] Auto-check failed:', error);
            }
          });

          const now = new Date();
          setLastChecked(now);
          safeSetItem('pwa-last-update-check', now.toISOString(), { scope: 'usePWAUpdate.lastChecked' });
        }, 60 * 60 * 1000);
      })
      .catch(() => {
        // SW unavailable
      });

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  // Re-check for waiting SW on BFCache restore or tab switch.
  // ALSO actively trigger reg.update() when the app is foregrounded — critical on
  // iOS Safari, where periodic SW update checks do not run while backgrounded.
  useEffect(() => {
    if (!('serviceWorker' in navigator) || isPreviewOrIframeEnvironment()) return;

    let lastForegroundUpdate = 0;
    const FOREGROUND_UPDATE_THROTTLE = 30 * 1000; // don't hammer SW more than once per 30s

    const recheckWaiting = () => {
      if (registration?.waiting) setNeedRefresh(true);
    };

    const triggerForegroundUpdateCheck = () => {
      const now = Date.now();
      if (now - lastForegroundUpdate < FOREGROUND_UPDATE_THROTTLE) return;
      lastForegroundUpdate = now;

      const reg = registration;
      if (!reg) return;

      void withTimeout(reg.update(), SW_UPDATE_TIMEOUT_MS, 'SW update (foreground)')
        .then(() => {
          if (reg.waiting) setNeedRefresh(true);
          const stamp = new Date();
          setLastChecked(stamp);
          safeSetItem('pwa-last-update-check', stamp.toISOString(), { scope: 'usePWAUpdate.lastChecked' });
        })
        .catch((error) => {
          if (import.meta.env.DEV) {
            console.warn('[PWA Update] Foreground update check failed:', error);
          }
        });
    };

    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        recheckWaiting();
        triggerForegroundUpdateCheck();
      }
    };
    const onVisChange = () => {
      if (document.visibilityState === 'visible') {
        recheckWaiting();
        triggerForegroundUpdateCheck();
      }
    };
    const onFocus = () => {
      recheckWaiting();
      triggerForegroundUpdateCheck();
    };

    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisChange);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [registration]);

  const checkForUpdates = useCallback(async (): Promise<UpdateCheckResult> => {
    if (!('serviceWorker' in navigator) || isPreviewOrIframeEnvironment()) return 'no_sw';
    setIsChecking(true);

    try {
      let reg = registration ?? await getAvailableServiceWorkerRegistration();

      if (!reg) {
        if (import.meta.env.DEV) {
          console.info('[PWA Update] Update check skipped — no service worker registration available');
        }
        return 'no_sw';
      }

      if (reg !== registration) {
        setRegistration(reg);
      }

      if (reg.waiting) {
        setNeedRefresh(true);
        return 'update_found';
      }

      let updateFound = false;
      const onUpdateFound = () => { updateFound = true; };
      reg.addEventListener('updatefound', onUpdateFound);

      try {
        await withTimeout(reg.update(), SW_UPDATE_TIMEOUT_MS, 'SW update');
      } catch (error) {
        const isTimeout = error instanceof Error && error.message.includes('timeout');
        if (!isTimeout) {
          reg.removeEventListener('updatefound', onUpdateFound);
          console.error('[PWA Update] Check failed:', error);
          return 'error';
        }
      }

      await new Promise(r => setTimeout(r, 100));

      reg.removeEventListener('updatefound', onUpdateFound);

      if (updateFound || reg.waiting) {
        setNeedRefresh(true);
        return 'update_found';
      }

      return 'up_to_date';
    } catch (error) {
      console.error('[PWA Update] Check failed:', error);
      return 'error';
    } finally {
      const now = new Date();
      setLastChecked(now);
      safeSetItem('pwa-last-update-check', now.toISOString(), { scope: 'usePWAUpdate.lastChecked' });
      setIsChecking(false);
    }
  }, [registration]);

  const updateServiceWorker = useCallback(async (reloadPage = true) => {
    if (registration?.waiting) {
      console.log('[PWA Update] Activating waiting service worker');

      if (reloadPage) {
        safeSetItem(UPDATE_APPLIED_KEY, 'true', { scope: 'usePWAUpdate.applied' });
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
        safeSetItem(UPDATE_APPLIED_KEY, 'true', { scope: 'usePWAUpdate.applied' });
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
