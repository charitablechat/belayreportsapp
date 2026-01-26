import { useState, useEffect, useRef } from 'react';

export interface NetworkStatus {
  isOnline: boolean;
  effectiveType: string | null;
  downlink: number | null;
  rtt: number | null;
  isVerified: boolean;
}

/**
 * Simplified network status hook that trusts browser's navigator.onLine
 * Removes aggressive verification that caused false offline detection
 */
export const useNetworkStatus = () => {
  // Always start with browser's current state
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isOnline: navigator.onLine,
    effectiveType: null,
    downlink: null,
    rtt: null,
    isVerified: true, // Trust browser by default
  });

  useEffect(() => {
    const updateNetworkInfo = () => {
      const connection = (navigator as any).connection || 
                         (navigator as any).mozConnection || 
                         (navigator as any).webkitConnection;
      
      setNetworkStatus({
        isOnline: navigator.onLine,
        effectiveType: connection?.effectiveType || null,
        downlink: connection?.downlink || null,
        rtt: connection?.rtt || null,
        isVerified: true,
      });
    };

    const handleOnline = () => {
      if (import.meta.env.DEV) {
        console.log('[Network] Browser reports online');
      }
      updateNetworkInfo();
    };

    const handleOffline = () => {
      if (import.meta.env.DEV) {
        console.log('[Network] Browser reports offline');
      }
      setNetworkStatus(prev => ({ ...prev, isOnline: false }));
    };

    // Initial state
    updateNetworkInfo();

    // Listen for online/offline events
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Listen for connection changes
    const connection = (navigator as any).connection || 
                       (navigator as any).mozConnection || 
                       (navigator as any).webkitConnection;
    if (connection) {
      connection.addEventListener('change', updateNetworkInfo);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (connection) {
        connection.removeEventListener('change', updateNetworkInfo);
      }
    };
  }, []);

  return networkStatus;
};
