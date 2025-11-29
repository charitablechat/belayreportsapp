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

export type ToastType = 'success' | 'error' | 'info' | 'warning';

/**
 * Get platform-specific toast configuration
 */
export function getToastConfig(): ToastConfig {
  const isMobileDevice = isMobile();
  
  // On mobile: show only errors and warnings with shorter duration
  if (isMobileDevice) {
    return {
      enabled: true,
      position: 'top-center',
      duration: 2000, // 2 seconds for mobile
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
 * Check if a specific toast should be shown on current platform
 * Use this before calling toast() to filter on mobile
 */
export function shouldShowToast(type?: ToastType): boolean {
  const config = getToastConfig();
  if (!config.enabled) return false;
  
  // On mobile, only show errors and warnings
  if (isMobile()) {
    if (!type) return false; // No type specified = likely info/success, hide on mobile
    return type === 'error' || type === 'warning';
  }
  
  return true;
}

/**
 * Helper to show mobile-aware toasts
 * Automatically filters based on platform and type
 */
export function showMobileToast(
  toastFn: () => void,
  type: ToastType = 'info'
): void {
  if (shouldShowToast(type)) {
    toastFn();
  }
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
