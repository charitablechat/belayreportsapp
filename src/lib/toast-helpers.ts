import { toast } from "@/components/ui/sonner";
import { isMobile } from "./mobile-detection";
import { 
  addSyncNotification, 
  addSaveNotification, 
  addErrorNotification,
  addNotification 
} from "./notification-center";

/**
 * Show a "HARD-SAVED" toast with Retro-Tech Terminal styling.
 * Only called on manual saves to avoid noise.
 */
export function showHardSavedToast(versionNumber?: number, fieldCount?: number) {
  const desc = [
    versionNumber !== undefined ? `v${versionNumber}` : null,
    fieldCount !== undefined ? `${fieldCount} fields` : null,
  ].filter(Boolean).join(' • ');

  toast.success('HARD-SAVED', {
    description: desc || 'Data committed to local storage',
    duration: 2000,
    style: {
      background: 'hsl(0, 0%, 5%)',
      color: 'hsl(120, 100%, 56%)',
      border: '1px solid hsl(120, 100%, 50%, 0.3)',
      fontFamily: 'monospace',
      fontSize: '12px',
      boxShadow: '0 0 8px hsl(120, 100%, 50%, 0.2)',
    },
  });
}

/**
 * Enhanced toast helpers with mobile-aware behavior
 * On mobile: routes non-critical toasts to notification center
 * On desktop: shows standard sonner toasts
 */

export function toastSuccess(message: string, description?: string) {
  if (isMobile()) {
    // Route to notification center on mobile
    if (/sync/i.test(message)) {
      addSyncNotification(message);
    } else {
      addSaveNotification(message);
    }
    return null;
  }
  
  return toast.success(message, {
    description,
    duration: 3000,
  });
}

export function toastError(message: string, description?: string) {
  // Errors always show as toast AND go to notification center
  addErrorNotification(message);
  return toast.error(message, {
    description,
    duration: 5000,
  });
}

export function toastWarning(message: string, description?: string) {
  if (isMobile()) {
    addNotification('info', message, 'medium');
    return null;
  }
  
  return toast.warning(message, {
    description,
    duration: 4000,
  });
}

export function toastInfo(message: string, description?: string) {
  if (isMobile()) {
    addNotification('info', message);
    return null;
  }
  
  return toast.info(message, {
    description,
    duration: 3000,
  });
}

/**
 * Progress toast for long-running operations
 * Returns a function to update or dismiss the toast
 * Note: Progress toasts always show on mobile (they're transient)
 */
export function toastProgress(message: string) {
  const toastId = toast.loading(message);

  return {
    id: toastId,
    update: (newMessage: string) => {
      toast.loading(newMessage, { id: toastId });
    },
    success: (successMessage: string) => {
      toast.success(successMessage, { id: toastId, duration: 3000 });
      if (isMobile()) {
        addSaveNotification(successMessage);
      }
    },
    error: (errorMessage: string) => {
      toast.error(errorMessage, { id: toastId, duration: 5000 });
      addErrorNotification(errorMessage);
    },
    dismiss: () => {
      toast.dismiss(toastId);
    },
  };
}

/**
 * Promise-based toast for async operations
 */
export function toastPromise<T>(
  promise: Promise<T>,
  messages: {
    loading: string;
    success: string | ((data: T) => string);
    error: string | ((error: any) => string);
  }
) {
  return toast.promise(promise, {
    loading: messages.loading,
    success: messages.success,
    error: messages.error,
  });
}
