import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface NetworkStatus {
  isOnline: boolean;
  effectiveType: string | null;
  downlink: number | null;
  rtt: number | null;
  isVerified: boolean;
}

const STORAGE_KEY = 'last-network-status';
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

export const useNetworkStatus = () => {
  // ALWAYS start optimistically online - let events drive offline detection
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isOnline: true,
    effectiveType: null,
    downlink: null,
    rtt: null,
    isVerified: false,
  });
  
  const debounceTimerRef = useRef<NodeJS.Timeout>();
  const verifyingRef = useRef(false);
  const retryCountRef = useRef(0);
  const lastVerifyTimeRef = useRef<number>(0);

  useEffect(() => {
    // Clear stale data
    localStorage.removeItem(STORAGE_KEY);
    
    // Enhanced connectivity verification with Supabase ping
    const verifyConnectivity = async (): Promise<boolean> => {
      if (verifyingRef.current) return networkStatus.isOnline;
      
      // Rate limit: only verify once every 5 seconds
      const now = Date.now();
      if (now - lastVerifyTimeRef.current < 5000) {
        return networkStatus.isOnline;
      }
      lastVerifyTimeRef.current = now;
      
      verifyingRef.current = true;
      
      try {
        // Try Supabase health check first (more reliable for actual functionality)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const { error } = await supabase.auth.getSession();
        clearTimeout(timeoutId);
        
        // No error means we can reach Supabase
        if (!error || error.message !== 'Failed to fetch') {
          if (import.meta.env.DEV) {
            console.log('[Network] Verified online via Supabase');
          }
          verifyingRef.current = false;
          return true;
        }
      } catch (error: any) {
        if (import.meta.env.DEV) {
          console.log('[Network] Supabase verification failed:', error.message);
        }
      }
      
      // Fallback to favicon check
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const response = await fetch('/favicon.ico', {
          method: 'HEAD',
          cache: 'no-cache',
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok || response.status === 304) {
          if (import.meta.env.DEV) {
            console.log('[Network] Verified online via favicon');
          }
          verifyingRef.current = false;
          return true;
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.log('[Network] Favicon verification failed:', error);
        }
      }
      
      verifyingRef.current = false;
      return false;
    };

    const updateNetworkStatus = async (skipVerification = false) => {
      const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      
      // Trust navigator.onLine as primary source, verify only when going online
      const browserOnline = navigator.onLine;
      const shouldVerify = !skipVerification && browserOnline;
      const isActuallyOnline = shouldVerify ? await verifyConnectivity() : browserOnline;
      
      const newStatus = {
        isOnline: isActuallyOnline,
        effectiveType: connection?.effectiveType || null,
        downlink: connection?.downlink || null,
        rtt: connection?.rtt || null,
        isVerified: shouldVerify,
      };
      
      setNetworkStatus(newStatus);
      
      // Store last known good state
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(isActuallyOnline));
      } catch (error) {
        // Ignore storage errors
      }

      if (import.meta.env.DEV) {
        console.log('[Network] Status updated:', {
          navigatorOnLine: navigator.onLine,
          actualOnline: isActuallyOnline,
          verified: shouldVerify,
          effectiveType: connection?.effectiveType,
          downlink: connection?.downlink,
          rtt: connection?.rtt,
        });
      }
    };

    const debouncedUpdate = (skipVerification = false) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        updateNetworkStatus(skipVerification);
      }, 300);
    };

    const handleOnline = () => {
      if (import.meta.env.DEV) {
        console.log('[Network Status] Browser reports online');
      }
      // Verify actual connectivity when browser reports online
      debouncedUpdate(false);
    };

    const handleOffline = () => {
      if (import.meta.env.DEV) {
        console.log('[Network Status] Browser reports offline - trusting immediately');
      }
      // Trust offline status immediately (skip verification)
      setNetworkStatus(prev => ({ ...prev, isOnline: false }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(false));
    };

    const handleConnectionChange = () => {
      if (import.meta.env.DEV) {
        console.log('[Network Status] Connection type changed, skipping verification');
      }
      // Don't reverify on connection type changes
      debouncedUpdate(true);
    };

    // Initial check - only mark offline if browser says so
    if (!navigator.onLine) {
      if (import.meta.env.DEV) {
        console.log('[Network] Initial check - browser is offline');
      }
      setNetworkStatus(prev => ({ ...prev, isOnline: false }));
    }

    // Add event listeners
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (connection) {
      connection.addEventListener('change', handleConnectionChange);
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (connection) {
        connection.removeEventListener('change', handleConnectionChange);
      }
    };
  }, []);

  return networkStatus;
};
