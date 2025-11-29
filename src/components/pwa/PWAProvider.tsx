import { createContext, ReactNode, Component, ErrorInfo } from 'react';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { usePWAUpdate } from '@/hooks/usePWAUpdate';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useSyncStatus } from '@/hooks/useSyncStatus';
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
    // In production, consider sending to error reporting service
    // Example: sendToErrorService(error, errorInfo);
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
        triggerSync: async () => {},
        updateUnsyncedCount: async () => {},
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

    return this.props.children;
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
  
  // Sync state
  unsyncedCount: number;
  unsyncedInspections: any[];
  isSyncing: boolean;
  lastSyncTime: Date | null;
  syncError: string | null;
  triggerSync: () => Promise<void>;
  updateUnsyncedCount: () => Promise<void>;
  
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
  const { 
    unsyncedCount,
    unsyncedInspections,
    isSyncing, 
    lastSyncTime, 
    syncError, 
    triggerSync,
    updateUnsyncedCount 
  } = useSyncStatus();
  const {
    unsyncedPhotoCount,
    photosByInspection,
    updatePhotoCount
  } = useUnsyncedPhotos();

  // Wrap updateServiceWorker to match the interface
  const updateAndReload = async () => {
    await updateServiceWorker(true);
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
    
    // Sync state
    unsyncedCount,
    unsyncedInspections,
    isSyncing,
    lastSyncTime,
    syncError,
    triggerSync,
    updateUnsyncedCount,
    
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
    <PWAErrorBoundary>
      <PWAProviderContent>
        {children}
      </PWAProviderContent>
    </PWAErrorBoundary>
  );
};
