import { useState, useEffect, useCallback, useRef } from 'react';
import { isLovablePreview } from '@/lib/environment';

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

const isPreviewOrIframeEnvironment = (): boolean => {
  try {
    return (
      isLovablePreview() ||
      window.location.hostname.includes('lovableproject.com') ||
      window.self !== window.top
    );
  } catch {
    return true;
  }
};

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
    if (!('serviceWorker' in navigator)) return;

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
          localStorage.setItem('pwa-last-update-check', now.toISOString());
        }, 60 * 60 * 1000);
      })
      .catch(() => {
        // SW unavailable
      });

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  // Re-check for waiting SW on BFCache restore or tab switch
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

  const checkForUpdates = useCallback(async (): Promise<UpdateCheckResult> => {
    if (!('serviceWorker' in navigator)) return 'no_sw';
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

      // Already waiting? Done.
      if (reg.waiting) {
        setNeedRefresh(true);
        return 'update_found';
      }

      // Listen for updatefound BEFORE calling update()
      const updatePromise = new Promise<boolean>((resolve) => {
        let settled = false;
        let onUpdateFound: (() => void) | null = null;

        const resolveOnce = (value: boolean) => {
          if (settled) return;
          settled = true;

          if (onUpdateFound) {
            reg!.removeEventListener('updatefound', onUpdateFound);
          }

          resolve(value);
        };

        onUpdateFound = () => {
          // updatefound confirms an update exists — resolve immediately
          resolveOnce(true);
        };

        reg!.addEventListener('updatefound', onUpdateFound);

        // Safety: resolve false after 4s if no update found
        window.setTimeout(() => {
          resolveOnce(false);
        }, UPDATE_DISCOVERY_TIMEOUT_MS);
      });

      let updateCallError: unknown = null;
      const updateCallPromise = withTimeout(reg.update(), SW_UPDATE_TIMEOUT_MS, 'SW update').catch((error) => {
        updateCallError = error;
      });

      const found = await updatePromise;

      // Check immediately after update discovery
      if (found || reg.waiting) {
        setNeedRefresh(true);
        return 'update_found';
      }

      await updateCallPromise;

      if (reg.waiting) {
        setNeedRefresh(true);
        return 'update_found';
      }

      if (updateCallError) {
        const isTimeout = updateCallError instanceof Error && 
          updateCallError.message.includes('timeout');
        if (!isTimeout) {
          console.error('[PWA Update] Check failed:', updateCallError);
          return 'error';
        }
      }

      return 'up_to_date';
    } catch (error) {
      console.error('[PWA Update] Check failed:', error);
      return 'error';
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
