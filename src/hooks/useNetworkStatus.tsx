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
  const consecutiveFailuresRef = useRef(0);
  const MAX_CONSECUTIVE_FAILURES = 3; // Only mark offline after 3 consecutive failures

  useEffect(() => {
    // Clear stale data
    localStorage.removeItem(STORAGE_KEY);
    
    // Enhanced connectivity verification with retry logic and grace period
    const verifyConnectivity = async (): Promise<boolean> => {
      if (verifyingRef.current) return networkStatus.isOnline;
      
      // Rate limit: only verify once every 5 seconds
      const now = Date.now();
      const backoffTime = Math.min(5000 * Math.pow(1.5, retryCountRef.current), 30000); // Exponential backoff up to 30s
      if (now - lastVerifyTimeRef.current < backoffTime) {
        return networkStatus.isOnline;
      }
      lastVerifyTimeRef.current = now;
      
      verifyingRef.current = true;
      
      let verificationPassed = false;
      
      // Try multiple verification methods with shorter timeouts
      try {
        // Method 1: Quick favicon check (fastest, most reliable for connectivity)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        
        const response = await fetch('/favicon.ico', {
          method: 'HEAD',
          cache: 'no-cache',
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok || response.status === 304) {
          if (import.meta.env.DEV) {
            console.log('[Network] ✓ Verified online via favicon');
          }
          verificationPassed = true;
        }
      } catch (error: any) {
        if (import.meta.env.DEV) {
          console.log('[Network] ✗ Favicon check failed:', error.message);
        }
      }
      
      // Method 2: Only try Supabase if favicon failed (more lenient on Supabase errors)
      if (!verificationPassed) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          
          const { error } = await supabase.auth.getSession();
          clearTimeout(timeoutId);
          
          // Be lenient: only fail if it's a clear network error
          const isNetworkError = error && (
            error.message.includes('Failed to fetch') ||
            error.message.includes('NetworkError') ||
            error.message.includes('ERR_')
          );
          
          if (!isNetworkError) {
            if (import.meta.env.DEV) {
              console.log('[Network] ✓ Verified online via Supabase (no network error)');
            }
            verificationPassed = true;
          }
        } catch (error: any) {
          if (import.meta.env.DEV) {
            console.log('[Network] ✗ Supabase check failed:', error.message);
          }
        }
      }
      
      verifyingRef.current = false;
      
      // Implement grace period: require multiple consecutive failures before marking offline
      if (verificationPassed) {
        consecutiveFailuresRef.current = 0;
        retryCountRef.current = 0; // Reset backoff on success
        return true;
      } else {
        consecutiveFailuresRef.current++;
        retryCountRef.current++; // Increment for exponential backoff
        if (import.meta.env.DEV) {
          console.log(`[Network] Verification failed (${consecutiveFailuresRef.current}/${MAX_CONSECUTIVE_FAILURES})`);
        }
        
        // Still report online until we hit the threshold
        return consecutiveFailuresRef.current < MAX_CONSECUTIVE_FAILURES;
      }
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
      // Reset consecutive failures when browser reports online
      consecutiveFailuresRef.current = 0;
      // Verify actual connectivity when browser reports online
      debouncedUpdate(false);
    };

    const handleOffline = () => {
      if (import.meta.env.DEV) {
        console.log('[Network Status] Browser reports offline - trusting immediately');
      }
      // Reset consecutive failures counter
      consecutiveFailuresRef.current = MAX_CONSECUTIVE_FAILURES;
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
