import { createContext, ReactNode } from 'react';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { usePWAUpdate } from '@/hooks/usePWAUpdate';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { useUnsyncedPhotos } from '@/hooks/useUnsyncedPhotos';

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

export const PWAProvider = ({ children }: PWAProviderProps) => {
  // Combine all PWA hooks
  const { isInstallable, isInstalled, isDismissed, promptInstall, dismissPrompt } = usePWAInstall();
  const { needRefresh: needsUpdate, offlineReady, updateServiceWorker } = usePWAUpdate();
  const { isOnline, effectiveType, downlink, rtt } = useNetworkStatus();
  const { 
    unsyncedCount, 
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
