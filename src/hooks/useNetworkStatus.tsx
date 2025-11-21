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
    // Always start with optimistic online state and clear any stale data
    console.log('[Network] Initializing - clearing stale offline state');
    localStorage.removeItem(STORAGE_KEY);
    setNetworkStatus(prev => ({ ...prev, isOnline: navigator.onLine }));

    // Lightweight connectivity verification - only as a secondary check
    const verifyConnectivity = async (): Promise<boolean> => {
      if (verifyingRef.current) return networkStatus.isOnline;
      verifyingRef.current = true;
      
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
            console.log('[Network] Verified online');
          }
          verifyingRef.current = false;
          return true;
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.log('[Network] Verification failed:', error);
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

    // Initial check - always start assuming online
    setNetworkStatus(prev => ({ ...prev, isOnline: true }));
    setTimeout(() => {
      if (import.meta.env.DEV) {
        console.log('[Network] Initial check - navigator.onLine:', navigator.onLine);
      }
      // Only update if truly offline
      if (!navigator.onLine) {
        updateNetworkStatus(false);
      }
    }, 100);

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
