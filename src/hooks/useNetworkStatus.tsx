import { useState, useEffect } from 'react';

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

  useEffect(() => {
    const updateNetworkStatus = () => {
      const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      
      setNetworkStatus({
        isOnline: navigator.onLine,
        effectiveType: connection?.effectiveType || null,
        downlink: connection?.downlink || null,
        rtt: connection?.rtt || null,
      });

      if (import.meta.env.DEV) {
        console.log('[Network Status] Status updated:', {
          isOnline: navigator.onLine,
          effectiveType: connection?.effectiveType,
          downlink: connection?.downlink,
          rtt: connection?.rtt,
        });
      }
    };

    const handleOnline = () => {
      if (import.meta.env.DEV) {
        console.log('[Network Status] Connection restored');
      }
      updateNetworkStatus();
    };

    const handleOffline = () => {
      if (import.meta.env.DEV) {
        console.log('[Network Status] Connection lost');
      }
      updateNetworkStatus();
    };

    const handleConnectionChange = () => {
      if (import.meta.env.DEV) {
        console.log('[Network Status] Connection type changed');
      }
      updateNetworkStatus();
    };

    // Initial status
    updateNetworkStatus();

    // Add event listeners
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (connection) {
      connection.addEventListener('change', handleConnectionChange);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (connection) {
        connection.removeEventListener('change', handleConnectionChange);
      }
    };
  }, []);

  return networkStatus;
};
