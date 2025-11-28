/**
 * Mobile-aware toast configuration and utilities
 * Manages toast behavior across desktop and mobile platforms
 */

import { isMobile, isIOS, isAndroid } from './mobile-detection';

export interface ToastConfig {
  enabled: boolean;
  position: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  duration: number;
  maxToasts: number;
}

/**
 * Get platform-specific toast configuration
 */
export function getToastConfig(): ToastConfig {
  const isMobileDevice = isMobile();
  
  // Completely disable toasts on mobile to prevent UI clutter
  if (isMobileDevice) {
    return {
      enabled: false,
      position: 'bottom-center',
      duration: 3000,
      maxToasts: 1,
    };
  }
  
  // Desktop configuration - normal behavior
  return {
    enabled: true,
    position: 'top-right',
    duration: 5000,
    maxToasts: 3,
  };
}

/**
 * Check if toasts should be shown on current platform
 */
export function shouldShowToast(): boolean {
  return getToastConfig().enabled;
}

/**
 * Get mobile platform info for debugging
 */
export function getToastPlatformInfo() {
  return {
    isMobile: isMobile(),
    isIOS: isIOS(),
    isAndroid: isAndroid(),
    toastEnabled: shouldShowToast(),
    config: getToastConfig(),
  };
}

/**
 * Log toast configuration on mount (dev only)
 */
export function logToastConfig(): void {
  if (import.meta.env.DEV) {
    const info = getToastPlatformInfo();
    console.log('[Toast Config] Platform configuration:', info);
  }
}
