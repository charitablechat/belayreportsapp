import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface UsePWAInstallReturn {
  isInstallable: boolean;
  isInstalled: boolean;
  isDismissed: boolean;
  promptInstall: () => Promise<void>;
  dismissPrompt: () => void;
}

export const usePWAInstall = (): UsePWAInstallReturn => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      if (import.meta.env.DEV) {
        console.log('[PWA Install] App is already installed (standalone mode)');
      }
      setIsInstalled(true);
      return;
    }

    // Check if dismissed in this session
    const dismissed = sessionStorage.getItem('pwa-install-dismissed');
    if (dismissed) {
      if (import.meta.env.DEV) {
        console.log('[PWA Install] Install prompt was dismissed in this session');
      }
      setIsDismissed(true);
    }

    // Listen for install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      if (import.meta.env.DEV) {
        console.log('[PWA Install] beforeinstallprompt event fired - app is installable');
      }
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    // Listen for app installed
    const handleAppInstalled = () => {
      if (import.meta.env.DEV) {
        console.log('[PWA Install] App successfully installed');
      }
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    if (import.meta.env.DEV) {
      console.log('[PWA Install] Hook initialized', {
        isStandalone: window.matchMedia('(display-mode: standalone)').matches,
        isDismissed: !!dismissed,
      });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) {
      if (import.meta.env.DEV) {
        console.log('[PWA Install] No install prompt available');
      }
      return;
    }

    if (import.meta.env.DEV) {
      console.log('[PWA Install] Showing install prompt to user');
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (import.meta.env.DEV) {
      console.log(`[PWA Install] User ${outcome === 'accepted' ? 'accepted' : 'dismissed'} the install prompt`);
    }
    
    setDeferredPrompt(null);
  };

  const dismissPrompt = () => {
    if (import.meta.env.DEV) {
      console.log('[PWA Install] Install prompt dismissed by user');
    }
    setIsDismissed(true);
    sessionStorage.setItem('pwa-install-dismissed', 'true');
  };

  return {
    isInstallable: !!deferredPrompt && !isInstalled,
    isInstalled,
    isDismissed,
    promptInstall,
    dismissPrompt,
  };
};
