import { toast } from "sonner";
import { CheckCircle, XCircle, AlertTriangle, Info, Loader2 } from "lucide-react";
import { createElement } from "react";

/**
 * Enhanced toast helpers with consistent styling and icons
 */

export function toastSuccess(message: string, description?: string) {
  return toast.success(message, {
    description,
    duration: 3000,
  });
}

export function toastError(message: string, description?: string) {
  return toast.error(message, {
    description,
    duration: 5000,
  });
}

export function toastWarning(message: string, description?: string) {
  return toast.warning(message, {
    description,
    duration: 4000,
  });
}

export function toastInfo(message: string, description?: string) {
  return toast.info(message, {
    description,
    duration: 3000,
  });
}

/**
 * Progress toast for long-running operations
 * Returns a function to update or dismiss the toast
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
    },
    error: (errorMessage: string) => {
      toast.error(errorMessage, { id: toastId, duration: 5000 });
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
