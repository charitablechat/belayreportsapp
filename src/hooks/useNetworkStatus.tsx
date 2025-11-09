import { useState, useEffect, useRef } from 'react';

export interface NetworkStatus {
  isOnline: boolean;
  effectiveType: string | null;
  downlink: number | null;
  rtt: number | null;
}

const STORAGE_KEY = 'last-network-status';
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

export const useNetworkStatus = () => {
  // Start with optimistic state or last known state
  const getInitialState = (): boolean => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : true; // Optimistic: assume online
    } catch {
      return true;
    }
  };

  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isOnline: getInitialState(),
    effectiveType: null,
    downlink: null,
    rtt: null,
  });
  
  const debounceTimerRef = useRef<NodeJS.Timeout>();
  const verifyingRef = useRef(false);
  const retryCountRef = useRef(0);

  useEffect(() => {
    // Multi-endpoint verification with retry logic
    const verifyConnectivity = async (retryAttempt = 0): Promise<boolean> => {
      if (verifyingRef.current) return networkStatus.isOnline;
      verifyingRef.current = true;
      
      const timeout = isMobile ? 7000 : 5000; // Longer timeout for mobile
      const endpoints = [
        '/favicon.ico',
        '/robots.txt',
        'https://www.gstatic.com/generate_204', // Google's connectivity check
      ];
      
      // Try each endpoint
      for (const endpoint of endpoints) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);
          
          const startTime = Date.now();
          const response = await fetch(endpoint, {
            method: 'HEAD',
            cache: 'no-cache',
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          const responseTime = Date.now() - startTime;
          
          if (response.ok || response.status === 304) {
            if (import.meta.env.DEV) {
              console.log(`[Network] Connected via ${endpoint} (${responseTime}ms)`);
            }
            verifyingRef.current = false;
            retryCountRef.current = 0;
            return true;
          }
        } catch (error) {
          if (import.meta.env.DEV) {
            console.log(`[Network] Failed to reach ${endpoint}:`, error);
          }
          continue; // Try next endpoint
        }
      }
      
      // All endpoints failed - retry with backoff
      if (retryAttempt < 3) {
        const backoffDelay = Math.pow(2, retryAttempt) * 1000; // 1s, 2s, 4s
        if (import.meta.env.DEV) {
          console.log(`[Network] Retry ${retryAttempt + 1}/3 after ${backoffDelay}ms`);
        }
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        verifyingRef.current = false;
        return verifyConnectivity(retryAttempt + 1);
      }
      
      verifyingRef.current = false;
      return false;
    };

    const updateNetworkStatus = async (skipVerification = false) => {
      const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      
      // Always verify on mobile, even when browser says we're online
      const shouldVerify = isMobile || !skipVerification;
      const isActuallyOnline = shouldVerify ? await verifyConnectivity() : navigator.onLine;
      
      const newStatus = {
        isOnline: isActuallyOnline,
        effectiveType: connection?.effectiveType || null,
        downlink: connection?.downlink || null,
        rtt: connection?.rtt || null,
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
          isMobile,
          navigatorOnLine: navigator.onLine,
          verifiedOnline: isActuallyOnline,
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
        console.log('[Network Status] Browser reports offline');
      }
      // Trust offline status immediately (skip verification)
      updateNetworkStatus(true);
    };

    const handleConnectionChange = () => {
      if (import.meta.env.DEV) {
        console.log('[Network Status] Connection type changed');
      }
      debouncedUpdate(true);
    };

    // Initial verification - be patient on mobile
    const initialDelay = isMobile ? 1000 : 500;
    setTimeout(() => {
      updateNetworkStatus(false);
    }, initialDelay);

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
