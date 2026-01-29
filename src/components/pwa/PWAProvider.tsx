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
        isOnline: navigator.onLine,
        effectiveType: null,
        downlink: null,
        rtt: null,
        unsyncedCount: 0,
        unsyncedInspections: [],
        isSyncing: false,
        lastSyncTime: null,
        syncError: this.state.error?.message || 'PWA initialization failed',
        updateUnsyncedCount: async () => {},
        forceSync: async () => {},
        unsyncedPhotoCount: 0,
        photosByInspection: {},
        updatePhotoCount: async () => {},
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
  
  // Network state
  isOnline: boolean;
  effectiveType: string | null;
  downlink: number | null;
  rtt: number | null;
  
  // Sync state (automatic with manual force sync option)
  unsyncedCount: number;
  unsyncedInspections: any[];
  isSyncing: boolean;
  lastSyncTime: Date | null;
  syncError: string | null;
  updateUnsyncedCount: () => Promise<void>;
  forceSync: () => Promise<void>;
  
  // Photo sync state
  unsyncedPhotoCount: number;
  photosByInspection: Record<string, number>;
  updatePhotoCount: () => Promise<void>;
}

export const PWAContext = createContext<PWAContextType | null>(null);

interface PWAProviderProps {
  children: ReactNode;
}

const PWAProviderContent = ({ children }: PWAProviderProps) => {
  // Combine all PWA hooks (wrapped in error boundary)
  const { isInstallable, isInstalled, isDismissed, promptInstall, dismissPrompt } = usePWAInstall();
  const { needRefresh: needsUpdate, offlineReady, updateServiceWorker } = usePWAUpdate();
  const { isOnline, effectiveType, downlink, rtt } = useNetworkStatus();
  
  // Use the new automatic sync hook with manual force sync option
  const { 
    unsyncedCount,
    isSyncing, 
    lastSyncTime, 
    updateUnsyncedCounts,
    performSync
  } = useAutoSync();
  
  const {
    unsyncedPhotoCount,
    photosByInspection,
    updatePhotoCount
  } = useUnsyncedPhotos();

  // Wrap updateServiceWorker to match the interface
  const updateAndReload = async () => {
    await updateServiceWorker(true);
  };

  // Force sync function for manual trigger
  const forceSync = async () => {
    await performSync(false); // Pass false for non-silent mode (will show errors if any)
  };

  const value: PWAContextType = {
    // Install state
    isInstallable,
    isInstalled,
    isDismissed,
    promptInstall,
    dismissPrompt,
    
    // Update state
    needsUpdate,
    offlineReady,
    updateAndReload,
    
    // Network state
    isOnline,
    effectiveType,
    downlink,
    rtt,
    
    // Sync state (automatic with manual force sync option)
    unsyncedCount,
    unsyncedInspections: [], // Simplified - detailed list not needed for passive indicator
    isSyncing,
    lastSyncTime,
    syncError: null, // Errors are handled silently in automatic sync
    updateUnsyncedCount: updateUnsyncedCounts,
    forceSync,
    
    // Photo sync state
    unsyncedPhotoCount,
    photosByInspection,
    updatePhotoCount,
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
