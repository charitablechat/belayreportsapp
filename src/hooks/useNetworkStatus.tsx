import { useState, useEffect, useRef } from 'react';

export interface NetworkStatus {
  isOnline: boolean;
  effectiveType: string | null;
  downlink: number | null;
  rtt: number | null;
}

export const useNetworkStatus = () => {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isOnline: navigator.onLine,
    effectiveType: null,
    downlink: null,
    rtt: null,
  });
  
  const debounceTimerRef = useRef<NodeJS.Timeout>();
  const verifyingRef = useRef(false);

  useEffect(() => {
    // Verify actual connectivity with a real request
    const verifyConnectivity = async (): Promise<boolean> => {
      if (verifyingRef.current) return navigator.onLine;
      verifyingRef.current = true;
      
      try {
        // Try to fetch a tiny resource with a short timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const response = await fetch('/favicon.ico', {
          method: 'HEAD',
          cache: 'no-cache',
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        verifyingRef.current = false;
        return response.ok || response.status === 304;
      } catch (error) {
        verifyingRef.current = false;
        // If fetch fails, we're likely offline
        return false;
      }
    };

    const updateNetworkStatus = async (skipVerification = false) => {
      const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      
      // For mobile browsers, verify actual connectivity
      const isActuallyOnline = skipVerification ? navigator.onLine : await verifyConnectivity();
      
      setNetworkStatus({
        isOnline: isActuallyOnline,
        effectiveType: connection?.effectiveType || null,
        downlink: connection?.downlink || null,
        rtt: connection?.rtt || null,
      });

      if (import.meta.env.DEV) {
        console.log('[Network Status] Status updated:', {
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

    // Initial status with delay to allow mobile browsers to establish connection
    setTimeout(() => {
      updateNetworkStatus(false);
    }, 500);

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
