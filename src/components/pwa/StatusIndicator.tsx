/**
 * StatusIndicator - Subtle, non-intrusive status indicator for mobile
 * Shows sync status without obstructing UI
 */

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Cloud, CloudOff, Check, AlertCircle, Loader2 } from 'lucide-react';
import { getLatestStatus, getRecentActivity } from '@/lib/notification-center';
import { isMobile } from '@/lib/mobile-detection';

interface StatusIndicatorProps {
  className?: string;
  showLabel?: boolean;
}

export function StatusIndicator({ className, showLabel = false }: StatusIndicatorProps) {
  const [status, setStatus] = useState<{
    type: 'idle' | 'syncing' | 'success' | 'error' | 'offline';
    message?: string;
  }>({ type: 'idle' });
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const updateStatus = () => {
      if (!navigator.onLine) {
        setStatus({ type: 'offline', message: 'Offline' });
        return;
      }

      const activity = getRecentActivity();
      const latest = getLatestStatus();

      if (activity.errors > 0) {
        setStatus({ type: 'error', message: `${activity.errors} error${activity.errors > 1 ? 's' : ''}` });
      } else if (activity.syncing) {
        setStatus({ type: 'syncing', message: 'Syncing...' });
      } else if (latest && latest.type === 'save') {
        setStatus({ type: 'success', message: 'Saved' });
        // Auto-clear success after 3 seconds
        setTimeout(() => {
          setStatus(prev => prev.type === 'success' ? { type: 'idle' } : prev);
        }, 3000);
      } else {
        setStatus({ type: 'idle' });
      }
    };

    updateStatus();
    
    // Update on network changes
    const handleOnline = () => {
      setIsOnline(true);
      updateStatus();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setStatus({ type: 'offline', message: 'Offline' });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Poll for updates
    const interval = setInterval(updateStatus, 2000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  // Don't show anything in idle state on mobile
  if (status.type === 'idle' && isMobile()) {
    return null;
  }

  const getIcon = () => {
    switch (status.type) {
      case 'syncing':
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
      case 'success':
        return <Check className="h-3.5 w-3.5 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
      case 'offline':
        return <CloudOff className="h-3.5 w-3.5 text-muted-foreground" />;
      default:
        return <Cloud className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 transition-opacity duration-300',
        status.type === 'idle' && 'opacity-50',
        className
      )}
    >
      {getIcon()}
      {showLabel && status.message && (
        <span className="text-xs text-muted-foreground">{status.message}</span>
      )}
    </div>
  );
}
