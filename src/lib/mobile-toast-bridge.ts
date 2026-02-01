/**
 * Mobile Toast Bridge
 * Redirects toast calls to notification center on mobile devices
 * Maintains toast behavior on desktop
 */

import { toast as sonnerToast } from 'sonner';
import { isMobile } from './mobile-detection';
import { 
  addNotification, 
  addSyncNotification, 
  addSaveNotification, 
  addErrorNotification 
} from './notification-center';

type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

interface ToastOptions {
  description?: string;
  duration?: number;
  id?: string | number;
  action?: {
    label: string;
    onClick: () => void;
  };
  icon?: React.ReactNode;
}

/**
 * Determines if a message should use the notification center
 * Returns false for critical messages that should always show as toasts
 */
function shouldUseNotificationCenter(message: string, type: ToastType): boolean {
  if (!isMobile()) return false;
  
  // Critical messages that should ALWAYS show as toasts (even on mobile)
  const criticalPatterns = [
    /error/i,
    /failed/i,
    /unauthorized/i,
    /session expired/i,
    /sign out/i,
    /delete/i,
    /removed/i,
    /conflict/i,
  ];
  
  // If it's an error type, always show toast
  if (type === 'error') return false;
  
  // Check for critical patterns
  for (const pattern of criticalPatterns) {
    if (pattern.test(message)) return false;
  }
  
  return true;
}

/**
 * Smart toast that routes to notification center on mobile for non-critical messages
 */
export function mobileToast(message: string, options?: ToastOptions) {
  if (shouldUseNotificationCenter(message, 'info')) {
    addNotification('info', message);
    return null;
  }
  return sonnerToast(message, options);
}

export function mobileToastSuccess(message: string, options?: ToastOptions) {
  if (shouldUseNotificationCenter(message, 'success')) {
    // Check if it's a sync or save message
    if (/sync/i.test(message)) {
      addSyncNotification(message);
    } else if (/save|saved|updated/i.test(message)) {
      addSaveNotification(message);
    } else {
      addNotification('save', message, 'low');
    }
    return null;
  }
  return sonnerToast.success(message, options);
}

export function mobileToastError(message: string, options?: ToastOptions) {
  // Errors always show as toasts AND go to notification center
  addErrorNotification(message);
  return sonnerToast.error(message, options);
}

export function mobileToastWarning(message: string, options?: ToastOptions) {
  if (shouldUseNotificationCenter(message, 'warning')) {
    addNotification('info', message, 'medium');
    return null;
  }
  return sonnerToast.warning(message, options);
}

export function mobileToastInfo(message: string, options?: ToastOptions) {
  if (shouldUseNotificationCenter(message, 'info')) {
    addNotification('info', message);
    return null;
  }
  return sonnerToast.info(message, options);
}

export function mobileToastLoading(message: string, options?: ToastOptions) {
  // Loading toasts always show on mobile (they're transient)
  return sonnerToast.loading(message, options);
}

/**
 * Smart promise toast that shows progress
 */
export function mobileToastPromise<T>(
  promise: Promise<T>,
  messages: {
    loading: string;
    success: string | ((data: T) => string);
    error: string | ((error: any) => string);
  }
) {
  // Promise toasts work the same on mobile and desktop
  return sonnerToast.promise(promise, messages);
}

/**
 * Dismiss a toast by ID
 */
export function mobileToastDismiss(id?: string | number) {
  return sonnerToast.dismiss(id);
}

/**
 * Export a unified toast object that mirrors sonner's API
 */
export const mobileAwareToast = {
  success: mobileToastSuccess,
  error: mobileToastError,
  warning: mobileToastWarning,
  info: mobileToastInfo,
  loading: mobileToastLoading,
  promise: mobileToastPromise,
  dismiss: mobileToastDismiss,
  // For direct calls
  message: mobileToast,
};
