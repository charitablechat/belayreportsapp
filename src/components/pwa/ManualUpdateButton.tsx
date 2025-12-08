import { useState, useRef } from 'react';
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
import { triggerHaptic } from '@/lib/haptics';
import { toast } from 'sonner';

export const ManualUpdateButton = () => {
  const { needsUpdate, updateAndReload } = usePWA();
  const [checking, setChecking] = useState(false);
  const previousNeedsUpdate = useRef(needsUpdate);

  const handleCheckForUpdates = async () => {
    triggerHaptic('light');
    
    if (needsUpdate) {
      toast.loading('Updating app...', { id: 'update-apply', description: 'Please wait while the app updates' });
      triggerHaptic('success');
      updateAndReload();
      return;
    }

    setChecking(true);
    toast.loading('Checking for updates...', { id: 'update-check' });
    
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.update();
        
        // Wait a bit to see if an update was found
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if there's a waiting service worker (update found)
        if (registration.waiting || registration.installing) {
          toast.dismiss('update-check');
          toast.success('Update found!', { 
            description: 'Click "Update App" to install the latest version',
            duration: 5000
          });
          triggerHaptic('success');
        } else {
          toast.dismiss('update-check');
          toast.info('App is up to date', { 
            description: 'You have the latest version',
            duration: 3000
          });
        }
        
        setChecking(false);
      } else {
        toast.dismiss('update-check');
        toast.info('Updates not supported', { 
          description: 'Service workers are not available in this browser'
        });
        setChecking(false);
      }
    } catch (error) {
      console.error('[Manual Update] Error checking for updates:', error);
      toast.dismiss('update-check');
      toast.error('Update check failed', { 
        description: 'Please try again later'
      });
      triggerHaptic('warning');
      setChecking(false);
    }
  };

  const handleForceRefresh = async () => {
    toast.loading('Clearing cache...', { id: 'force-refresh' });
    
    try {
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
      
      // Reload the page after a brief delay
      toast.dismiss('force-refresh');
      toast.success('Cache cleared!', { description: 'Reloading app...' });
      triggerHaptic('success');
      
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      console.error('[Force Refresh] Error:', error);
      toast.dismiss('force-refresh');
      toast.error('Failed to clear cache', { description: 'Please try again' });
      triggerHaptic('warning');
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
            <span>Update App</span>
          </>
        ) : (
          <>
            <Smartphone className={`w-4 h-4 ${checking ? 'animate-pulse' : ''}`} />
            <span>Check for Updates</span>
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
