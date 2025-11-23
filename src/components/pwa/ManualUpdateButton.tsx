import { useState } from 'react';
import { RefreshCw, Smartphone, MoreVertical, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { usePWA } from '@/hooks/usePWA';
import { toast } from 'sonner';
import { isMobile } from '@/lib/mobile-detection';
import { triggerHaptic } from '@/lib/haptics';

export const ManualUpdateButton = () => {
  const { needsUpdate, updateAndReload } = usePWA();
  const [checking, setChecking] = useState(false);

  const handleCheckForUpdates = async () => {
    triggerHaptic('light'); // Haptic feedback when checking for updates
    
    if (needsUpdate) {
      // Update is already available
      triggerHaptic('success');
      updateAndReload();
      return;
    }

    setChecking(true);
    
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.update();
        
        // Wait a bit to see if an update was found
        setTimeout(() => {
          if (!needsUpdate) {
            toast.success('App is up to date', {
              description: 'You\'re running the latest version',
            });
          }
          setChecking(false);
        }, 1000);
      }
    } catch (error) {
      console.error('[Manual Update] Error checking for updates:', error);
      toast.error('Failed to check for updates');
      setChecking(false);
    }
  };

  const handleForceRefresh = async () => {
    triggerHaptic('warning'); // Warning haptic for cache clearing
    
    try {
      toast.loading('Clearing cache and refreshing...', { id: 'force-refresh' });
      
      // Unregister all service workers
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(reg => reg.unregister()));
      }
      
      // Clear all caches
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }
      
      // Clear IndexedDB (optional - be careful with this)
      if ('indexedDB' in window) {
        // Only clear specific databases if needed, not all user data
        // For now, we'll skip this to preserve user data
      }
      
      toast.dismiss('force-refresh');
      toast.success('Cache cleared! Reloading...', {
        description: 'The app will reload with a fresh version',
      });
      
      // Reload the page after a brief delay
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      console.error('[Force Refresh] Error:', error);
      toast.dismiss('force-refresh');
      toast.error('Failed to clear cache');
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant={needsUpdate ? "default" : "outline"}
        size="sm"
        onClick={handleCheckForUpdates}
        disabled={checking}
        className="gap-2"
      >
        {needsUpdate ? (
          <>
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Update App</span>
          </>
        ) : (
          <>
            <Smartphone className={`w-4 h-4 ${checking ? 'animate-pulse' : ''}`} />
            <span className="hidden sm:inline">Check Updates</span>
          </>
        )}
      </Button>
      
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="px-2">
            <MoreVertical className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleCheckForUpdates} disabled={checking}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Check for Updates
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleForceRefresh} className="text-destructive">
            <Trash2 className="w-4 h-4 mr-2" />
            Force Refresh (Clear Cache)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
