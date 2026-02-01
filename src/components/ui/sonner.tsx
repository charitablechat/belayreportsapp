import { useTheme } from "next-themes";
import { Toaster as Sonner, toast as sonnerToast, ExternalToast } from "sonner";
import { isMobile } from "@/lib/mobile-detection";
import { routeToastToNotification } from "@/lib/notification-center";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Create a mobile-aware toast wrapper that routes ALL toasts to
 * the notification center on mobile devices, eliminating screen overlays.
 */
function createMobileAwareToast() {
  const checkMobile = () => isMobile();
  
  return {
    success: (message: string, data?: ExternalToast) => {
      if (checkMobile()) {
        routeToastToNotification(message, 'success');
        return null;
      }
      return sonnerToast.success(message, data);
    },
    error: (message: string, data?: ExternalToast) => {
      if (checkMobile()) {
        routeToastToNotification(message, 'error');
        return null;
      }
      return sonnerToast.error(message, data);
    },
    warning: (message: string, data?: ExternalToast) => {
      if (checkMobile()) {
        routeToastToNotification(message, 'warning');
        return null;
      }
      return sonnerToast.warning(message, data);
    },
    info: (message: string, data?: ExternalToast) => {
      if (checkMobile()) {
        routeToastToNotification(message, 'info');
        return null;
      }
      return sonnerToast.info(message, data);
    },
    loading: (message: string, data?: ExternalToast) => {
      if (checkMobile()) {
        routeToastToNotification(message, 'loading');
        return null;
      }
      return sonnerToast.loading(message, data);
    },
    promise: <T,>(
      promise: Promise<T>, 
      messages: { loading: string; success: string | ((data: T) => string); error: string | ((error: unknown) => string) }
    ) => {
      if (checkMobile()) {
        routeToastToNotification(messages.loading, 'loading');
        promise
          .then((data) => {
            const successMsg = typeof messages.success === 'function' 
              ? messages.success(data) 
              : messages.success;
            routeToastToNotification(successMsg, 'success');
          })
          .catch((error) => {
            const errorMsg = typeof messages.error === 'function' 
              ? messages.error(error) 
              : messages.error;
            routeToastToNotification(errorMsg, 'error');
          });
        return promise;
      }
      return sonnerToast.promise(promise, messages);
    },
    dismiss: (id?: string | number) => {
      if (checkMobile()) return; // No-op on mobile
      return sonnerToast.dismiss(id);
    },
    // Default toast call (when using toast("message"))
    message: (message: string, data?: ExternalToast) => {
      if (checkMobile()) {
        routeToastToNotification(message, 'info');
        return null;
      }
      return sonnerToast(message, data);
    },
    // Keep custom for edge cases that need special handling
    custom: sonnerToast.custom,
  };
}

// Export the mobile-aware toast
export const toast = createMobileAwareToast();

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        duration: 60000,
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
