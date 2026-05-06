import { useTheme } from "next-themes";
import { Toaster as Sonner, toast as sonnerToast, ExternalToast } from "sonner";
import { isMobile } from "@/lib/mobile-detection";
import { routeToastToNotification } from "@/lib/notification-center";
import { 
  classifyMessage, 
  getToastDuration, 
  CriticalityLevel,
  ToastType 
} from "@/lib/notification-config";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Create a mobile-aware toast wrapper that applies criticality-based filtering:
 * - 'critical': Always show as toast (all platforms)
 * - 'standard': Toast on desktop, notification center on mobile  
 * - 'silent': Notification center only (all platforms)
 */
function createFilteredToast() {
  const checkMobile = () => isMobile();
  
  const shouldShowToast = (message: string, type: ToastType): { show: boolean; duration: number } => {
    const criticality = classifyMessage(message, type);
    const duration = getToastDuration(criticality, type);
    
    // Critical: always show
    if (criticality === 'critical') {
      return { show: true, duration };
    }
    
    // Silent: never show toast
    if (criticality === 'silent') {
      return { show: false, duration };
    }
    
    // Standard: show on desktop only
    return { show: !checkMobile(), duration };
  };
  
  return {
    success: (message: string, data?: ExternalToast) => {
      const { show, duration } = shouldShowToast(message, 'success');
      
      // Always route to notification center (for history)
      routeToastToNotification(message, 'success');
      
      if (!show) return null;
      return sonnerToast.success(message, { duration, ...data });
    },
    
    error: (message: string, data?: ExternalToast) => {
      const { duration } = shouldShowToast(message, 'error');
      
      // Errors always go to notification center AND show as toast
      routeToastToNotification(message, 'error');
      return sonnerToast.error(message, { duration, ...data });
    },
    
    warning: (message: string, data?: ExternalToast) => {
      const { show, duration } = shouldShowToast(message, 'warning');
      
      routeToastToNotification(message, 'warning');
      
      if (!show) return null;
      return sonnerToast.warning(message, { duration, ...data });
    },
    
    info: (message: string, data?: ExternalToast) => {
      const { show, duration } = shouldShowToast(message, 'info');
      
      routeToastToNotification(message, 'info');
      
      if (!show) return null;
      return sonnerToast.info(message, { duration, ...data });
    },
    
    loading: (message: string, data?: ExternalToast) => {
      const { show } = shouldShowToast(message, 'loading');
      
      routeToastToNotification(message, 'loading');
      
      if (!show) return null;
      return sonnerToast.loading(message, data);
    },
    
    promise: <T,>(
      promise: Promise<T>, 
      messages: { loading: string; success: string | ((data: T) => string); error: string | ((error: unknown) => string) }
    ) => {
      const loadingCriticality = classifyMessage(messages.loading, 'loading');
      const isCritical = loadingCriticality === 'critical';
      
      // For non-critical promises on mobile, route to notification center
      if (checkMobile() && !isCritical) {
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
      return sonnerToast.dismiss(id);
    },
    
    // Default toast call
    message: (message: string, data?: ExternalToast) => {
      const { show, duration } = shouldShowToast(message, 'info');
      
      routeToastToNotification(message, 'info');
      
      if (!show) return null;
      return sonnerToast(message, { duration, ...data });
    },
    
    // Keep custom for edge cases
    custom: sonnerToast.custom,
  };
}

// Export the filtered toast
export const toast = createFilteredToast();

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Cap visible toasts so background sync/storage events can't stack into
      // an alarming wall. Critical errors still surface; routine info gets
      // collapsed/replaced rather than piled up.
      visibleToasts={2}
      toastOptions={{
        duration: 3500,
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
