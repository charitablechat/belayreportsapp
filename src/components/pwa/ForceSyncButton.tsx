import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePWA } from "@/hooks/usePWA";
import { toast } from "sonner";
import { triggerHaptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { isMobile } from "@/lib/mobile-detection";

interface ForceSyncButtonProps {
  variant?: 'default' | 'icon' | 'menu-item';
  className?: string;
}

/**
 * Force Sync Button Component
 * Allows users to manually trigger a complete data synchronization
 * 
 * Variants:
 * - default: Full button with text (desktop)
 * - icon: Icon-only button (mobile header)
 * - menu-item: For use inside dropdown menus (styled as menu item)
 */
export const ForceSyncButton = ({ variant = 'default', className }: ForceSyncButtonProps) => {
  const { forceSync, isSyncing, isOnline } = usePWA();
  const isMobileDevice = isMobile();

  const handleForceSync = async () => {
    // Check if online
    if (!isOnline) {
      triggerHaptic('error');
      toast.error("Cannot sync while offline", {
        description: "Please check your internet connection and try again."
      });
      return;
    }

    // Already syncing
    if (isSyncing) {
      toast.info("Sync already in progress...");
      return;
    }

    // Trigger haptic feedback on mobile
    if (isMobileDevice) {
      triggerHaptic('medium');
    }

    // Show initiated toast
    toast.info("Sync initiated...", {
      description: "Synchronizing your data with the server."
    });

    try {
      await forceSync();
      
      triggerHaptic('success');
      toast.success("Sync completed successfully", {
        description: "All your data is now up to date."
      });
    } catch (error: any) {
      console.error('[ForceSyncButton] Sync failed:', error);
      triggerHaptic('error');
      toast.error("Sync failed", {
        description: error.message || "Please try again later."
      });
    }
  };

  // Icon-only variant (mobile)
  if (variant === 'icon') {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={handleForceSync}
        disabled={!isOnline || isSyncing}
        className={cn("relative", className)}
        aria-label="Force sync"
      >
        <RefreshCw 
          className={cn(
            "h-5 w-5",
            isSyncing && "animate-spin"
          )} 
        />
      </Button>
    );
  }

  // Menu item variant (dropdown menus)
  if (variant === 'menu-item') {
    return (
      <button
        onClick={handleForceSync}
        disabled={!isOnline || isSyncing}
        className={cn(
          "relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          "focus:bg-accent focus:text-accent-foreground",
          "disabled:pointer-events-none disabled:opacity-50",
          className
        )}
      >
        <RefreshCw 
          className={cn(
            "h-4 w-4",
            isSyncing && "animate-spin"
          )} 
        />
        {isSyncing ? "Syncing..." : "Force Sync Now"}
      </button>
    );
  }

  // Default variant (full button with text)
  return (
    <Button
      variant="outline"
      onClick={handleForceSync}
      disabled={!isOnline || isSyncing}
      className={cn("gap-2", className)}
    >
      <RefreshCw 
        className={cn(
          "h-4 w-4",
          isSyncing && "animate-spin"
        )} 
      />
      {isSyncing ? "Syncing..." : "Force Sync Now"}
    </Button>
  );
};
