import { isBackgroundSyncSupported } from '@/lib/background-sync';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { InfoIcon, Loader2 } from 'lucide-react';
import { isIOS } from '@/lib/mobile-detection';
import { usePWA } from '@/hooks/usePWA';
import { useLocation } from 'react-router-dom';

const PUBLIC_ROUTES = ['/', '/welcome'];

/**
 * Surfaces a contextual notice for browsers without the Background Sync API
 * (primarily Safari / iOS). On iOS we also show the live unsynced item count
 * and instruct the user to keep the app open until sync completes — since iOS
 * suspends background work aggressively.
 *
 * Suppressed on public routes (welcome screen) to avoid crowding the landing UI.
 */
export const BackgroundSyncStatus = () => {
  const isSupported = isBackgroundSyncSupported();
  const { unsyncedCount, isSyncing, isOnline } = usePWA();
  const location = useLocation();

  if (PUBLIC_ROUTES.includes(location.pathname)) return null;
  if (isSupported) return null;

  const isIOSDevice = isIOS();
  const hasPending = unsyncedCount > 0;

  // Nothing to nag about: not iOS, nothing pending → keep banner minimal.
  if (!isIOSDevice && !hasPending) {
    return (
      <Alert className="mb-4 border-primary/20 bg-primary/5">
        <InfoIcon className="h-4 w-4 text-primary" />
        <AlertDescription className="text-foreground">
          Background sync isn't supported on this browser. Keep the app open while syncing data.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="mb-4 border-primary/20 bg-primary/5">
      {isSyncing ? (
        <Loader2 className="h-4 w-4 text-primary animate-spin" />
      ) : (
        <InfoIcon className="h-4 w-4 text-primary" />
      )}
      <AlertTitle className="text-foreground">
        {isSyncing
          ? 'Syncing your data…'
          : hasPending
            ? `${unsyncedCount} item${unsyncedCount === 1 ? '' : 's'} waiting to sync`
            : 'Keep the app open to sync'}
      </AlertTitle>
      <AlertDescription className="text-muted-foreground">
        {isIOSDevice ? (
          <>
            iPad and iPhone don't support background syncing. Please keep this app
            open and on-screen until the sync indicator shows everything is up to date
            {!isOnline && ' — and reconnect to the internet'}.
          </>
        ) : (
          <>This browser doesn't support background syncing. Keep the app open until sync completes.</>
        )}
      </AlertDescription>
    </Alert>
  );
};
