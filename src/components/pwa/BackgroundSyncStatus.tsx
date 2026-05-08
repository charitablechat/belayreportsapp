import { isBackgroundSyncSupported } from '@/lib/background-sync';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { InfoIcon, Loader2 } from 'lucide-react';
import { isIOS } from '@/lib/mobile-detection';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePWA } from '@/hooks/usePWA';
import { useLocation } from 'react-router-dom';

const PUBLIC_ROUTES = ['/', '/welcome'];

/**
 * Surfaces a contextual notice about how this app's foreground sync works.
 *
 * Sprint 2 E: previously the non-iOS branch said "this browser doesn't
 * support background syncing", which read to users like a defect on Chrome
 * (where the Background Sync API IS supported) — but
 * `isBackgroundSyncSupported()` was hard-pinned to `false` in PR #82 / S8
 * because cross-browser quirks made the API unreliable for production use.
 * The app deliberately uses a foreground periodic timer instead. The new
 * copy is positive and accurate: it explains what the user actually needs
 * to do (keep the tab open) and how often a sync will fire.
 *
 * iOS branch retained as-is: iOS Safari's bfcache + aggressive backgrounding
 * behave more punitively than desktop, so the additional "keep on-screen"
 * + "RUN SELF-CHECK" guidance is meaningful there.
 *
 * Suppressed on public routes (welcome screen) to avoid crowding the landing UI.
 */
export const BackgroundSyncStatus = () => {
  const isSupported = isBackgroundSyncSupported();
  const { unsyncedCount, isSyncing, isOnline } = usePWA();
  const isMobile = useIsMobile();
  const location = useLocation();

  if (PUBLIC_ROUTES.includes(location.pathname)) return null;
  if (isSupported) return null;

  const isIOSDevice = isIOS();
  const hasPending = unsyncedCount > 0;
  // Mirrors the active-sync interval in `useAutoSync.tsx` (DESKTOP_SYNC_INTERVAL=30s,
  // MOBILE_SYNC_INTERVAL=60s). Surfacing this in the banner lets users
  // self-calibrate "is my sync stuck or just on a cadence" without a screenshot.
  const cadenceLabel = isMobile ? 'about every minute' : 'about every 30 seconds';

  // Nothing to nag about: not iOS, nothing pending → keep banner minimal.
  if (!isIOSDevice && !hasPending) {
    return (
      <Alert className="mb-4 border-primary/20 bg-primary/5">
        <InfoIcon className="h-4 w-4 text-primary" />
        <AlertDescription className="text-foreground">
          Sync runs automatically while this tab is open ({cadenceLabel}). You can keep working — pending items
          will upload in the background.
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
            {hasPending && (
              <span className="block mt-1 text-xs">
                If a number stays stuck, tap the sync dot in the header and use{' '}
                <strong>RUN SELF-CHECK</strong> — it will tell you whether the device
                is signed in correctly or if specific records need to be reassigned.
              </span>
            )}
          </>
        ) : (
          <>
            Sync runs automatically while this tab is open ({cadenceLabel}). Keep the
            tab open until pending items finish uploading
            {!isOnline && ' — and reconnect to the internet'}.
          </>
        )}
      </AlertDescription>
    </Alert>
  );
};
