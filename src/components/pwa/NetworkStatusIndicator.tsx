import { useEffect, useRef } from 'react';
import { Cloud, CloudOff, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { usePWA } from '@/hooks/usePWA';
import { Badge } from '@/components/ui/badge';

export const NetworkStatusIndicator = () => {
  const { isOnline, effectiveType } = usePWA();
  const previousOnlineStatus = useRef<boolean>(isOnline);

  useEffect(() => {
    // Only show toast when there's an actual transition between online/offline
    if (previousOnlineStatus.current !== isOnline) {
      if (isOnline) {
        toast.dismiss('offline-notification');
        toast.success('Connection restored', {
          description: effectiveType ? `Connected via ${effectiveType}` : 'You are back online',
          icon: <Cloud className="w-4 h-4" />,
        });
      } else {
        toast.error('You are offline', {
          description: 'Data will sync when connection is restored',
          icon: <CloudOff className="w-4 h-4" />,
          duration: Infinity,
          id: 'offline-notification',
        });
      }
      previousOnlineStatus.current = isOnline;
    }
  }, [isOnline, effectiveType]);

  return (
    <Badge 
      variant={isOnline ? "outline" : "secondary"}
      className="gap-2"
    >
      {isOnline ? (
        <>
          <Wifi className="w-4 h-4" />
          <span>Online</span>
          {effectiveType && <span className="text-xs opacity-70">({effectiveType})</span>}
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
