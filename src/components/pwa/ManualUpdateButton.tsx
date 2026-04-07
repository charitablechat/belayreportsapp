import { useState, useRef, useEffect } from 'react';
import { RefreshCw, Smartphone, MoreVertical, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { usePWA } from '@/hooks/usePWA';
import { triggerHaptic } from '@/lib/haptics';
import { toast } from 'sonner';

const UPDATE_FLAG_KEY = 'pwa-update-pending';

export const ManualUpdateButton = () => {
  const { needsUpdate, updateAndReload, unsyncedCount, forceSync, isSyncing, checkForUpdates } = usePWA();
  const [checking, setChecking] = useState(false);
  const [showForceRefreshDialog, setShowForceRefreshDialog] = useState(false);
  const [showUnsyncedWarning, setShowUnsyncedWarning] = useState(false);
  const previousNeedsUpdate = useRef(needsUpdate);

  // Check if app was just updated after reload
  useEffect(() => {
    const wasUpdating = localStorage.getItem(UPDATE_FLAG_KEY);
    if (wasUpdating) {
      localStorage.removeItem(UPDATE_FLAG_KEY);
      toast.success('App updated successfully!', {
        description: 'You are now running the latest version',
        duration: 5000
      });
      triggerHaptic('success');
    }
  }, []);

  // Watch for needsUpdate transitions to show toast
  useEffect(() => {
    if (needsUpdate && !previousNeedsUpdate.current) {
      toast.dismiss('update-check');
      toast.success('Update found!', {
        description: 'Click "Update App" to install the latest version',
        duration: 5000
      });
      triggerHaptic('success');
    }
    previousNeedsUpdate.current = needsUpdate;
  }, [needsUpdate]);

  const handleCheckForUpdates = async () => {
    triggerHaptic('light');
    
    if (needsUpdate) {
      localStorage.setItem(UPDATE_FLAG_KEY, 'true');
      toast.loading('Updating app...', { id: 'update-apply', description: 'Please wait while the app updates' });
      triggerHaptic('success');
      updateAndReload();
      return;
    }

    setChecking(true);
    toast.loading('Checking for updates...', { id: 'update-check' });
    
    try {
      const result = await checkForUpdates();
      toast.dismiss('update-check');
      if (result === 'up_to_date') {
        toast.info('App is up to date', { 
          description: 'You have the latest version',
          duration: 3000
        });
      } else if (result === 'no_sw') {
        toast.info('App is up to date', { 
          description: 'Update checks are available in the installed app',
          duration: 3000
        });
      } else if (result === 'error') {
        toast.error('Update check failed', { 
          description: 'Please try again later'
        });
        triggerHaptic('warning');
      }
      // 'update_found' case handled by the useEffect above
    } catch (error) {
      console.error('[Manual Update] Error checking for updates:', error);
      toast.dismiss('update-check');
      toast.error('Update check failed', { 
        description: 'Please try again later'
      });
      triggerHaptic('warning');
    } finally {
      setChecking(false);
    }
  };

  const handleForceRefreshRequest = () => {
    if (unsyncedCount > 0) {
      setShowUnsyncedWarning(true);
    } else {
      setShowForceRefreshDialog(true);
    }
  };

  const handleSyncFirst = async () => {
    setShowUnsyncedWarning(false);
    toast.loading('Syncing data...', { id: 'sync-first' });
    try {
      await forceSync();
      toast.dismiss('sync-first');
      toast.success('Sync complete!', { description: 'You can now safely force refresh.' });
      triggerHaptic('success');
    } catch {
      toast.dismiss('sync-first');
      toast.error('Sync failed', { description: 'Please try again or proceed with caution.' });
      triggerHaptic('warning');
    }
  };

  const handleForceRefreshAnyway = () => {
    setShowUnsyncedWarning(false);
    setShowForceRefreshDialog(true);
  };

  const handleForceRefresh = async () => {
    setShowForceRefreshDialog(false);
    toast.loading('Clearing cache...', { id: 'force-refresh' });
    
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(reg => reg.unregister()));
      }
      
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }
      
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
    <>
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
            <DropdownMenuItem
              onClick={handleForceRefreshRequest}
              className="text-destructive"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Force Refresh (Clear Cache)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={showForceRefreshDialog} onOpenChange={setShowForceRefreshDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force Refresh</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear all cached data and make the app unavailable offline until you reconnect to the internet. Your report data will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleForceRefresh}>
              Clear Cache & Reload
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showUnsyncedWarning} onOpenChange={setShowUnsyncedWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsynced Data Detected</AlertDialogTitle>
            <AlertDialogDescription>
              You have {unsyncedCount} unsynced report{unsyncedCount !== 1 ? 's' : ''}. Force refreshing will not delete your data, but the app won't work offline until you reconnect. We recommend syncing first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSyncFirst} disabled={isSyncing}>
              {isSyncing ? 'Syncing...' : 'Sync First'}
            </AlertDialogAction>
            <AlertDialogAction onClick={handleForceRefreshAnyway} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Force Refresh Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
