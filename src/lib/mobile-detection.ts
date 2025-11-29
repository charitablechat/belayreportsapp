/**
 * Mobile platform detection and capability checks
 * 
 * IMPORTANT: For React components, prefer using useIsMobile() hook from use-mobile.tsx
 * which combines both user agent and screen width detection for unified mobile detection.
 * 
 * This file provides low-level detection utilities for:
 * - Non-React contexts (utility functions, service workers, etc.)
 * - Platform-specific checks (iOS, Android)
 * - Capability checks (PWA features, storage, etc.)
 */

export interface MobileCapabilities {
  isIOS: boolean;
  isAndroid: boolean;
  isMobile: boolean;
  browser: string;
  hasServiceWorker: boolean;
  hasIndexedDB: boolean;
  hasBackgroundSync: boolean;
  hasPeriodicSync: boolean;
  isPWA: boolean;
}

/**
 * Detect if running on iOS
 */
export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Detect if running on Android
 */
export function isAndroid(): boolean {
  return /Android/.test(navigator.userAgent);
}

/**
 * Detect if running on mobile device
 */
export function isMobile(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Detect browser type
 */
export function getBrowser(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Edg')) return 'Edge';
  return 'Unknown';
}

/**
 * Check if running as PWA
 */
export function isPWA(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true ||
    document.referrer.includes('android-app://');
}

/**
 * Get comprehensive mobile capabilities
 */
export function getMobileCapabilities(): MobileCapabilities {
  return {
    isIOS: isIOS(),
    isAndroid: isAndroid(),
    isMobile: isMobile(),
    browser: getBrowser(),
    hasServiceWorker: 'serviceWorker' in navigator,
    hasIndexedDB: 'indexedDB' in window,
    hasBackgroundSync: 'serviceWorker' in navigator && 'SyncManager' in window,
    hasPeriodicSync: 'serviceWorker' in navigator && 'periodicSync' in ServiceWorkerRegistration.prototype,
    isPWA: isPWA(),
  };
}

/**
 * Log mobile capabilities for debugging
 */
export function logMobileCapabilities(): void {
  const caps = getMobileCapabilities();
  console.log('[Mobile Detection] Capabilities:', {
    platform: caps.isIOS ? 'iOS' : caps.isAndroid ? 'Android' : 'Desktop',
    browser: caps.browser,
    isPWA: caps.isPWA,
    features: {
      serviceWorker: caps.hasServiceWorker,
      indexedDB: caps.hasIndexedDB,
      backgroundSync: caps.hasBackgroundSync,
      periodicSync: caps.hasPeriodicSync,
    },
  });
}

/**
 * Request persistent storage (important for mobile)
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage || !navigator.storage.persist) {
    return false;
  }

  try {
    const isPersisted = await navigator.storage.persisted();
    
    if (!isPersisted) {
      const granted = await navigator.storage.persist();
      
      if (import.meta.env.DEV) {
        console.log('[Mobile Detection] Persistent storage:', granted ? 'granted' : 'denied');
      }
      
      return granted;
    }
    
    return true;
  } catch (error) {
    console.error('[Mobile Detection] Persistent storage request failed:', error);
    return false;
  }
}

/**
 * Check storage quota
 */
export async function checkStorageQuota(): Promise<{
  usage: number;
  quota: number;
  percentUsed: number;
}> {
  if (!navigator.storage || !navigator.storage.estimate) {
    return { usage: 0, quota: 0, percentUsed: 0 };
  }

  try {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;

    if (import.meta.env.DEV) {
      console.log('[Mobile Detection] Storage:', {
        usage: `${(usage / 1024 / 1024).toFixed(2)} MB`,
        quota: `${(quota / 1024 / 1024).toFixed(2)} MB`,
        percentUsed: `${percentUsed.toFixed(2)}%`,
      });
    }

    return { usage, quota, percentUsed };
  } catch (error) {
    console.error('[Mobile Detection] Storage quota check failed:', error);
    return { usage: 0, quota: 0, percentUsed: 0 };
  }
}
