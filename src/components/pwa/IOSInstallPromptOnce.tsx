import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { isIOS, isPWA } from '@/lib/mobile-detection';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Share, X } from 'lucide-react';

const STORAGE_KEY = 'ios-install-prompt-dismissed-v1';
const PUBLIC_ROUTES = ['/', '/welcome'];

/**
 * One-time, dismissible nudge for iOS Safari users to add the app to their
 * Home Screen. Installed PWAs receive persistent storage on iOS 16.4+ and
 * dramatically improve sync reliability (avoids 7-day IndexedDB eviction).
 *
 * Hidden once the user dismisses it or installs the app.
 * Suppressed entirely on public routes (welcome screen).
 */
export const IOSInstallPromptOnce = () => {
  const [show, setShow] = useState(false);
  const location = useLocation();
  const isPublicRoute = PUBLIC_ROUTES.includes(location.pathname);

  useEffect(() => {
    if (isPublicRoute) return;
    if (!isIOS() || isPWA()) return;
    if (localStorage.getItem(STORAGE_KEY) === '1') return;
    setShow(true);
  }, [isPublicRoute]);

  if (isPublicRoute || !show) return null;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setShow(false);
  };

  return (
    <Alert className="mb-4 border-primary/30 bg-primary/5 relative pr-10">
      <Share className="h-4 w-4 text-primary" />
      <AlertTitle className="text-foreground">Add to Home Screen for reliable sync</AlertTitle>
      <AlertDescription className="text-muted-foreground">
        Tap the <span className="font-medium">Share</span> icon in Safari, then
        <span className="font-medium"> Add to Home Screen</span>. This protects your
        offline data and keeps sync working between sessions.
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
