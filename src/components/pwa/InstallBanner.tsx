import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePWA } from '@/hooks/usePWA';

export const InstallBanner = () => {
  const { isInstallable, isDismissed, promptInstall, dismissPrompt } = usePWA();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isInstallable && !isDismissed) {
      if (import.meta.env.DEV) {
        console.log('[Install Banner] Banner will show in 2 seconds');
      }
      
      // Show banner after 2 seconds
      const timer = setTimeout(() => {
        if (import.meta.env.DEV) {
          console.log('[Install Banner] Showing banner');
        }
        setIsVisible(true);
      }, 2000);
      
      // Auto-hide after 15 seconds
      const hideTimer = setTimeout(() => {
        if (import.meta.env.DEV) {
          console.log('[Install Banner] Auto-hiding banner after 15 seconds');
        }
        setIsVisible(false);
      }, 17000);

      return () => {
        clearTimeout(timer);
        clearTimeout(hideTimer);
      };
    } else if (import.meta.env.DEV) {
      console.log('[Install Banner] Banner not shown', { isInstallable, isDismissed });
    }
  }, [isInstallable, isDismissed]);

  const handleInstall = async () => {
    if (import.meta.env.DEV) {
      console.log('[Install Banner] Install button clicked');
    }
    await promptInstall();
    setIsVisible(false);
  };

  const handleDismiss = () => {
    if (import.meta.env.DEV) {
      console.log('[Install Banner] Dismiss button clicked');
    }
    dismissPrompt();
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 animate-in slide-in-from-bottom duration-300">
      <div className="bg-gradient-to-r from-primary to-primary/90 text-primary-foreground shadow-lg">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1">
              <div className="hidden sm:flex h-12 w-12 items-center justify-center rounded-lg bg-background/10">
                <Download className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-sm sm:text-base">Install Belay Reports</h3>
                <p className="text-xs sm:text-sm text-primary-foreground/90">
                  Work offline • Faster access • Home screen shortcut
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                onClick={handleInstall}
                size="sm"
                variant="secondary"
                className="font-semibold"
              >
                Install
              </Button>
              <Button
                onClick={handleDismiss}
                size="sm"
                variant="ghost"
                className="text-primary-foreground hover:bg-background/10"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Dismiss</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
