/**
 * Mobile-aware toast wrapper that always renders but filters individual toasts
 */

import { useEffect } from 'react';
import { Toaster as ShadcnToaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { logToastConfig } from '@/lib/mobile-toast-config';

/**
 * Shadcn UI toast wrapper - always renders, filtering happens at toast call level
 */
export function MobileAwareToaster() {
  useEffect(() => {
    logToastConfig();
  }, []);
  
  return <ShadcnToaster />;
}

/**
 * Sonner toast wrapper - always renders, filtering happens at toast call level
 */
export function MobileAwareSonner() {
  return <SonnerToaster />;
}
