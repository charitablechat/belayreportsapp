import { useContext } from 'react';
import { PWAContext, PWAContextType } from '@/components/pwa/PWAProvider';

// Safe defaults when context is unavailable (during error recovery or init)
const fallbackContext: PWAContextType = {
  isInstallable: false,
  isInstalled: false,
  isDismissed: false,
  promptInstall: async () => {},
  dismissPrompt: () => {},
  needsUpdate: false,
  offlineReady: false,
  updateAndReload: async () => {},
  lastUpdateCheck: null,
  isCheckingForUpdate: false,
  checkForUpdates: async () => 'error' as const,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  effectiveType: null,
  downlink: null,
  rtt: null,
  unsyncedCount: 0,
  unsyncedInspections: [],
  unsyncedTrainings: [],
  unsyncedAssessments: [],
  isSyncing: false,
  lastSyncTime: null,
  syncError: null,
  updateUnsyncedCount: async () => {},
  forceSync: async () => {},
  unsyncedPhotoCount: 0,
  photosByInspection: {},
  updatePhotoCount: async () => {},
  deadLetterCount: 0,
};

export const usePWA = (): PWAContextType => {
  const context = useContext(PWAContext);
  
  // Return safe defaults if context unavailable (graceful degradation)
  if (!context) {
    if (import.meta.env.DEV) {
      console.warn('[usePWA] Context unavailable, using fallback defaults');
    }
    return fallbackContext;
  }
  
  return context;
};
