import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { isIOS, isPWA } from '@/lib/mobile-detection';
import { useUnsyncedPhotos } from '@/hooks/useUnsyncedPhotos';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Share, X } from 'lucide-react';

const STORAGE_KEY = 'ios-install-prompt-dismissed-v1';
const PUBLIC_ROUTES = ['/', '/welcome'];

/**
 * Dismissible nudge for iOS Safari users to add the app to their Home Screen.
 * Installed PWAs receive persistent storage on iOS 16.4+ and dramatically
 * improve sync reliability (avoids 7-day IndexedDB eviction).
 *
 * Behavior:
 *   - Hidden on public routes and inside an installed PWA.
 *   - Hidden once dismissed by the user...
 *   - ...UNLESS persistent storage was denied AND the user has unsynced data.
 *     In that case the prompt re-appears with stronger, data-loss-aware wording
 *     (Gap 5: data could be evicted in 7 days of inactivity).
 */
export const IOSInstallPromptOnce = () => {
  const [show, setShow] = useState(false);
  const [isPersisted, setIsPersisted] = useState<boolean | null>(null);
  const location = useLocation();
  const { status } = useUnsyncedPhotos() as any; // hook returns { status } in some versions
  const unsyncedCount =
    (status && typeof status.unsyncedPhotoCount === 'number' ? status.unsyncedPhotoCount : 0) ||
    0;
  const isPublicRoute = PUBLIC_ROUTES.includes(location.pathname);

  // Probe persistent-storage state once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (navigator.storage && navigator.storage.persisted) {
          const persisted = await navigator.storage.persisted();
          if (!cancelled) setIsPersisted(persisted);
        } else {
          if (!cancelled) setIsPersisted(false);
        }
      } catch {
        if (!cancelled) setIsPersisted(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isPublicRoute) return;
    if (!isIOS() || isPWA()) return;

    const dismissed = localStorage.getItem(STORAGE_KEY) === '1';
    const atRisk = isPersisted === false && unsyncedCount > 0;

    // Always show if data is at risk, even after a previous dismissal.
    if (atRisk) {
      setShow(true);
      return;
    }
    if (dismissed) return;
    setShow(true);
  }, [isPublicRoute, isPersisted, unsyncedCount]);

  if (isPublicRoute || !show) return null;

  const atRisk = isPersisted === false && unsyncedCount > 0;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setShow(false);
  };

  return (
    <Alert
      className={`mb-4 relative pr-10 ${
        atRisk ? 'border-destructive/40 bg-destructive/10' : 'border-primary/30 bg-primary/5'
      }`}
    >
      <Share className={`h-4 w-4 ${atRisk ? 'text-destructive' : 'text-primary'}`} />
      <AlertTitle className="text-foreground">
        {atRisk
          ? `You have ${unsyncedCount} unsynced ${unsyncedCount === 1 ? 'item' : 'items'} at risk`
          : 'Add to Home Screen for reliable sync'}
      </AlertTitle>
      <AlertDescription className="text-muted-foreground">
        {atRisk ? (
          <>
            iOS may delete your offline data after 7 days of inactivity. Tap the{' '}
            <span className="font-medium">Share</span> icon in Safari, then{' '}
            <span className="font-medium">Add to Home Screen</span> to protect it.
          </>
        ) : (
          <>
            Tap the <span className="font-medium">Share</span> icon in Safari, then
            <span className="font-medium"> Add to Home Screen</span>. This protects your
            offline data and keeps sync working between sessions.
          </>
        )}
      </AlertDescription>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-6 w-6"
        onClick={dismiss}
        aria-label="Dismiss install prompt"
      >
        <X className="h-4 w-4" />
      </Button>
    </Alert>
  );
};
