import { createContext, ReactNode, Component, ErrorInfo } from 'react';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { usePWAUpdate } from '@/hooks/usePWAUpdate';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useAutoSync } from '@/hooks/useAutoSync';
import { useUnsyncedPhotos } from '@/hooks/useUnsyncedPhotos';

// Error Boundary for PWA Provider
class PWAErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Only log in development to avoid console noise in production
    if (import.meta.env.DEV) {
      console.error('[PWA Provider] Error caught by boundary:', error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      // Provide degraded PWA context with safe defaults
      const fallbackValue: PWAContextType = {
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
        isOnline: navigator.onLine,
        effectiveType: null,
        downlink: null,
        rtt: null,
        unsyncedCount: 0,
        unsyncedInspections: [],
        unsyncedTrainings: [],
        unsyncedAssessments: [],
        isSyncing: false,
        lastSyncTime: null,
        syncError: this.state.error?.message || 'PWA initialization failed',
        syncErrorSeverity: 'fatal',
        updateUnsyncedCount: async () => {},
        forceSync: async () => {},
        unsyncedPhotoCount: 0,
        photosByInspection: {},
        updatePhotoCount: async () => {},
        deadLetterCount: 0,
      };

      return (
        <PWAContext.Provider value={fallbackValue}>
          {this.props.children}
        </PWAContext.Provider>
      );
    }

    // Normal case: render PWAProviderContent which provides the actual context
    return <PWAProviderContent>{this.props.children}</PWAProviderContent>;
  }
}

export interface PWAContextType {
  // Install state
  isInstallable: boolean;
  isInstalled: boolean;
  isDismissed: boolean;
  promptInstall: () => Promise<void>;
  dismissPrompt: () => void;
  
  // Update state
  needsUpdate: boolean;
  offlineReady: boolean;
  updateAndReload: () => Promise<void>;
  lastUpdateCheck: Date | null;
  isCheckingForUpdate: boolean;
  checkForUpdates: () => Promise<'update_found' | 'up_to_date' | 'no_sw' | 'error'>;
  
  // Network state
  isOnline: boolean;
  effectiveType: string | null;
  downlink: number | null;
  rtt: number | null;
  
  // Sync state
  unsyncedCount: number;
  unsyncedInspections: any[];
  unsyncedTrainings: any[];
  unsyncedAssessments: any[];
  isSyncing: boolean;
  lastSyncTime: Date | null;
  syncError: string | null;
  /** S42 (Fix F): 'fatal' = pipeline crashed, render red SYNC FAILED.
   *  'soft' = stats/photo-counts read hiccup, render amber advisory only. */
  syncErrorSeverity: 'fatal' | 'soft' | null;
  updateUnsyncedCount: () => Promise<void>;
  /** Bypass throttles and re-read unsynced state directly from IndexedDB.
   *  Use after Hard Reset, Drain end, quarantine retry, etc. */
  refreshSyncStateFromStorage: () => Promise<void>;
  forceSync: () => Promise<void>;
  
  // Photo sync state
  unsyncedPhotoCount: number;
  photosByInspection: Record<string, number>;
  updatePhotoCount: () => Promise<void>;
  deadLetterCount: number;
}

export const PWAContext = createContext<PWAContextType | null>(null);

interface PWAProviderProps {
  children: ReactNode;
}

const PWAProviderContent = ({ children }: PWAProviderProps) => {
  const { isInstallable, isInstalled, isDismissed, promptInstall, dismissPrompt } = usePWAInstall();
  const { needRefresh: needsUpdate, offlineReady, updateServiceWorker, lastChecked, isChecking, checkForUpdates } = usePWAUpdate();
  const { isOnline, effectiveType, downlink, rtt } = useNetworkStatus();
  
  const { 
    unsyncedCount,
    unsyncedInspections,
    unsyncedTrainings,
    unsyncedAssessments,
    isSyncing, 
    lastSyncTime, 
    syncError: autoSyncError,
    syncErrorSeverity: autoSyncErrorSeverity,
    updateUnsyncedCounts,
    performSync
  } = useAutoSync();
  
  const {
    unsyncedPhotoCount,
    photosByInspection,
    updatePhotoCount,
    deadLetterCount,
    idbReadError: photoIdbError,
  } = useUnsyncedPhotos();

  const updateAndReload = async () => {
    await updateServiceWorker(true);
  };

  const forceSync = async () => {
    await performSync(false);
  };

  // Combine sync errors from both sources (auto-sync IDB failures + photo IDB failures).
  // Photo error wins only when there's no broader sync error to show.
  const syncError = autoSyncError ?? photoIdbError ?? null;
  // S42 (Fix F): Both stats-counts and photo-counts read failures are non-fatal
  // (the sync pipeline itself is fine). Default to 'soft' when photoIdbError is
  // the only signal. Never promote to 'fatal' here.
  const syncErrorSeverity: PWAContextType['syncErrorSeverity'] =
    autoSyncError ? autoSyncErrorSeverity ?? 'soft'
    : photoIdbError ? 'soft'
    : null;

  const value: PWAContextType = {
    isInstallable,
    isInstalled,
    isDismissed,
    promptInstall,
    dismissPrompt,
    needsUpdate,
    offlineReady,
    updateAndReload,
    lastUpdateCheck: lastChecked,
    isCheckingForUpdate: isChecking,
    checkForUpdates,
    isOnline,
    effectiveType,
    downlink,
    rtt,
    unsyncedCount,
    unsyncedInspections,
    unsyncedTrainings,
    unsyncedAssessments,
    isSyncing,
    lastSyncTime,
    syncError,
    syncErrorSeverity,
    updateUnsyncedCount: updateUnsyncedCounts,
    forceSync,
    unsyncedPhotoCount,
    photosByInspection,
    updatePhotoCount,
    deadLetterCount,
  };

  return (
    <PWAContext.Provider value={value}>
      {children}
    </PWAContext.Provider>
  );
};

export const PWAProvider = ({ children }: PWAProviderProps) => {
  return (
    <PWAErrorBoundary children={children} />
  );
};
