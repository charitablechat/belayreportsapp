/**
 * Mobile-aware toast wrapper that conditionally renders based on platform
 */

import { useEffect } from 'react';
import { Toaster as ShadcnToaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { shouldShowToast, logToastConfig } from '@/lib/mobile-toast-config';

/**
 * Shadcn UI toast wrapper with mobile detection
 */
export function MobileAwareToaster() {
  const enabled = shouldShowToast();
  
  useEffect(() => {
    logToastConfig();
  }, []);
  
  // Suppress toasts on mobile platforms
  if (!enabled) {
    if (import.meta.env.DEV) {
      console.log('[Mobile Toast] Toasts disabled on mobile platform');
    }
    return null;
  }
  
  return <ShadcnToaster />;
}

/**
 * Sonner toast wrapper with mobile detection
 */
export function MobileAwareSonner() {
  const enabled = shouldShowToast();
  
  // Suppress toasts on mobile platforms
  if (!enabled) {
    return null;
  }
  
  return <SonnerToaster />;
}
