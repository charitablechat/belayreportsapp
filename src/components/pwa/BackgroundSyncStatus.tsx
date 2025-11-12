import { isBackgroundSyncSupported } from '@/lib/background-sync';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { InfoIcon } from 'lucide-react';

/**
 * Display a warning for browsers that don't support Background Sync API
 * (mainly Safari/iOS)
 */
export const BackgroundSyncStatus = () => {
  const isSupported = isBackgroundSyncSupported();
  
  if (isSupported) return null;
  
  return (
    <Alert className="mb-4 border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
      <InfoIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
      <AlertDescription className="text-blue-800 dark:text-blue-300">
        Background sync is not supported on this browser. 
        Please keep the app open while syncing data.
      </AlertDescription>
    </Alert>
  );
};
