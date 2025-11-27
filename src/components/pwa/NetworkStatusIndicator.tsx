import { useEffect, useRef, useState } from 'react';
import { Cloud, CloudOff, Wifi, WifiOff } from 'lucide-react';
import { usePWA } from '@/hooks/usePWA';
import { Badge } from '@/components/ui/badge';

export const NetworkStatusIndicator = () => {
  const { isOnline, effectiveType } = usePWA();
  const previousOnlineStatus = useRef<boolean | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const offlineTimerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // Give time for initial network detection to stabilize
    const initTimer = setTimeout(() => {
      setIsInitialized(true);
      previousOnlineStatus.current = isOnline;
    }, 2000);

    return () => clearTimeout(initTimer);
  }, []);

  useEffect(() => {
    // Don't show toasts until initialized
    if (!isInitialized || previousOnlineStatus.current === null) {
      return;
    }

    // Only log when there's an actual transition between online/offline
    if (previousOnlineStatus.current !== isOnline) {
      if (isOnline) {
        // Clear any pending offline notification
        if (offlineTimerRef.current) {
          clearTimeout(offlineTimerRef.current);
          offlineTimerRef.current = undefined;
        }
        if (import.meta.env.DEV) {
          console.log('[Network Status] Connection restored');
        }
        previousOnlineStatus.current = isOnline;
      } else {
        // Add grace period before logging offline status
        offlineTimerRef.current = setTimeout(() => {
          if (import.meta.env.DEV) {
            console.log('[Network Status] Offline - data will sync when connection is restored');
          }
        }, 2000);
        previousOnlineStatus.current = isOnline;
      }
    }

    return () => {
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
      }
    };
  }, [isOnline, effectiveType, isInitialized]);

  return (
    <Badge 
      variant={isOnline ? "outline" : "secondary"}
      className="gap-2"
    >
      {isOnline ? (
        <>
          <Wifi className="w-4 h-4" />
          <span>Online</span>
        </>
      ) : (
        <>
          <WifiOff className="w-4 h-4" />
          <span>Offline</span>
        </>
      )}
    </Badge>
  );
};
