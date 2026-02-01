/**
 * Mobile-aware toast wrappers that hide toast overlays on mobile devices.
 * On mobile, all toasts are routed to the Notification Center instead.
 */

import { isMobile } from '@/lib/mobile-detection';
import { Toaster as ShadcnToaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

/**
 * Shadcn UI toast wrapper - hidden on mobile
 */
export function MobileAwareToaster() {
  // Don't render Toaster at all on mobile - toasts go to notification center
  if (isMobile()) {
    return null;
  }
  return <ShadcnToaster />;
}

/**
 * Sonner toast wrapper - hidden on mobile
 */
export function MobileAwareSonner() {
  // Don't render Sonner at all on mobile - toasts go to notification center
  if (isMobile()) {
    return null;
  }
  return <SonnerToaster />;
}
