import { useEffect, useCallback, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { syncAllInspectionsAtomic, syncAllTrainingsAtomic, syncAllDailyAssessmentsAtomic } from '@/lib/atomic-sync-manager';
import { syncPhotos } from '@/lib/sync-manager';
import { getUnsyncedInspections, getUnsyncedTrainings, getUnsyncedDailyAssessments } from '@/lib/offline-storage';
import { getUserWithCache } from '@/lib/cached-auth';
import { hasPendingOfflineAuth, verifyAndReconcileOfflineAuth } from '@/lib/offline-auth';
import { useQueryClient } from '@tanstack/react-query';
import { isMobile, isIOS } from '@/lib/mobile-detection';
import { useIsMobile } from '@/hooks/use-mobile';
import { addSyncNotification } from '@/lib/notification-center';
import { emitSyncComplete } from '@/lib/sync-events';
import { clearPendingSyncs } from '@/lib/background-sync';
import { toast } from '@/components/ui/sonner';

// Sync configuration with mobile optimization
const DEBOUNCE_DELAY = 3000; // 3 seconds after local changes
const DESKTOP_SYNC_INTERVAL = 30000; // 30 seconds for desktop
const MOBILE_SYNC_INTERVAL = 60000; // 60 seconds for mobile (reduced from 5min for faster sync)
const MIN_SYNC_INTERVAL = 5000; // Minimum 5 seconds between syncs
const INITIAL_SYNC_DELAY = 2000; // 2 seconds delay for initial sync to not block UI
const BASE_SYNC_TIMEOUT = 30000; // Base 30 second timeout
const PER_ITEM_TIMEOUT_BUDGET = 8000; // 8 seconds budget per unsynced item
const MAX_SYNC_TIMEOUT = 300000; // 5 minute absolute maximum
const MAX_BATCH_SIZE = 5; // Must match atomic-sync-manager.ts
const ACCELERATED_SYNC_DELAY = 5000; // 5s between cycles when draining a queue

/**
 * Helper to wrap promises with a timeout
 * Returns { result, timedOut } to differentiate between timeout and successful null
 */
function withSyncTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<{ result: T | null; timedOut: boolean }> {
  let timeoutHandle: NodeJS.Timeout;
  
  const timeoutPromise = new Promise<{ result: null; timedOut: true }>((resolve) => {
    timeoutHandle = setTimeout(() => {
      console.warn('[AutoSync] Sync operation timed out after', timeoutMs, 'ms');
      resolve({ result: null, timedOut: true });
    }, timeoutMs);
  });
  
  const wrappedPromise = promise.then((result) => {
    clearTimeout(timeoutHandle);
    return { result, timedOut: false as const };
  });
  
  return Promise.race([wrappedPromise, timeoutPromise]);
}

export interface AutoSyncState {
  isSyncing: boolean;
  lastSyncTime: Date | null;
  unsyncedCount: number;
  unsyncedPhotoCount: number;
}

/**
 * Unified hook for fully automatic background synchronization
 * - Debounced sync after local data changes
 * - Immediate sync on network reconnection
 * - Sync on app visibility changes
 * - Periodic polling as fallback
 * - Realtime subscriptions for multi-device sync
 */
export const useAutoSync = () => {
  const queryClient = useQueryClient();
  const isMobileDevice = isMobile();
  const isIOSDevice = isIOS();
  const isMobileViewport = useIsMobile();
  
  // Compute sync interval based on viewport (5 min mobile, 30s desktop)
  const syncInterval = isMobileViewport ? MOBILE_SYNC_INTERVAL : DESKTOP_SYNC_INTERVAL;
  
  const [state, setState] = useState<AutoSyncState>({
    isSyncing: false,
    lastSyncTime: null,
    unsyncedCount: 0,
    unsyncedPhotoCount: 0,
  });
  
  // Refs for debouncing and preventing duplicate syncs
  const lastSyncAttemptRef = useRef<number>(0);
  const syncInProgressRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const periodicSyncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  
  /**
   * Perform the actual sync operation
   */
  const performSync = useCallback(async (silent = true) => {
    // Skip if offline
    if (!navigator.onLine) {
      if (import.meta.env.DEV) {
        console.log('[AutoSync] Offline - skipping sync');
      }
      return;
    }
    
    // Skip if no authenticated user - prevents noisy "No valid session" errors
    const user = await getUserWithCache();
    if (!user) {
      if (import.meta.env.DEV) {
        console.log('[AutoSync] No authenticated user - skipping sync');
      }
      return;
    }
    
    // Prevent duplicate sync calls
    if (syncInProgressRef.current) {
      if (import.meta.env.DEV) {
        console.log('[AutoSync] Sync already in progress - skipping');
      }
      // Return a promise that resolves when current sync completes
      // This prevents callers from thinking sync is done immediately
      return new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (!syncInProgressRef.current) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 500);
        // Safety: resolve after 35s regardless
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 35000);
      });
    }
    
    // Debounce protection
    const now = Date.now();
    if (now - lastSyncAttemptRef.current < MIN_SYNC_INTERVAL) {
      if (import.meta.env.DEV) {
        console.log('[AutoSync] Too soon since last sync - debouncing');
      }
      return;
    }
    
    lastSyncAttemptRef.current = now;
    syncInProgressRef.current = true;
    setState(prev => ({ ...prev, isSyncing: true }));
    
    // Calculate dynamic timeout based on BATCH size (not total unsynced)
    // With MAX_BATCH_SIZE=5: 30s + (5 x 8s) = 70s -- well within safe limits
    const batchSize = Math.min(state.unsyncedCount, MAX_BATCH_SIZE);
    const dynamicTimeout = Math.min(
      BASE_SYNC_TIMEOUT + (batchSize * PER_ITEM_TIMEOUT_BUDGET),
      MAX_SYNC_TIMEOUT
    );
    
    // Safety: Force-reset sync state after timeout regardless of promise resolution
    const safetyTimeoutHandle = setTimeout(() => {
      if (syncInProgressRef.current) {
        console.warn('[AutoSync] Safety timeout - force resetting sync state');
        syncInProgressRef.current = false;
        setState(prev => ({ ...prev, isSyncing: false }));
      }
    }, dynamicTimeout + 2000); // 2 seconds after main timeout as final safety
    
    try {
      if (import.meta.env.DEV) {
        console.log('[AutoSync] Starting sync...', { unsyncedCount: state.unsyncedCount, timeout: dynamicTimeout });
      }
      
      // Sync all data types in parallel with dynamic timeout protection
      // Each operation has its own catch to prevent one failure from blocking others
      const syncResult = await withSyncTimeout(
        Promise.all([
          syncAllInspectionsAtomic().catch(e => { console.error('[AutoSync] Inspections sync failed:', e); return null; }),
          syncAllTrainingsAtomic().catch(e => { console.error('[AutoSync] Trainings sync failed:', e); return null; }),
          syncAllDailyAssessmentsAtomic().catch(e => { console.error('[AutoSync] Assessments sync failed:', e); return null; }),
          syncPhotos().catch(e => { console.error('[AutoSync] Photos sync failed:', e); return null; }),
        ]),
        dynamicTimeout
      );
      
      // Clear safety timeout since we completed normally
      clearTimeout(safetyTimeoutHandle);
      
      if (syncResult.timedOut) {
        console.warn('[AutoSync] Sync timed out - resetting state');
      } else if (import.meta.env.DEV) {
        console.log('[AutoSync] Sync completed successfully');
      }
      
      // Update state - always reset isSyncing
      setState(prev => ({
        ...prev,
        isSyncing: false,
        lastSyncTime: syncResult.timedOut ? prev.lastSyncTime : new Date(),
      }));
      
      // Only do post-sync work if we didn't time out
      if (!syncResult.timedOut) {
        // Check if any sync actually happened or if all returned -1 (fetch failed due to timeout)
        const results = (syncResult.result as any[]) || [];
        const allFetchesFailed = results.length > 0 && results.every(r => r?.total === -1);
        const anySuccess = results.some(r => r?.success > 0);
        const totalSynced = results.reduce((sum, r) => sum + (r?.success || 0), 0);
        const totalRemaining = results.reduce((sum, r) => sum + (r?.remaining || 0), 0);
        
        if (!allFetchesFailed) {
          // Refresh unsynced counts (non-blocking)
          updateUnsyncedCounts().catch(() => {});
          
          // Invalidate queries to refresh UI
          queryClient.invalidateQueries({ queryKey: ['inspections'] });
          queryClient.invalidateQueries({ queryKey: ['trainings'] });
          queryClient.invalidateQueries({ queryKey: ['daily-assessments'] });
          
          // Mobile: Log sync success to console for debugging without toast spam
          if (isMobileDevice) {
            console.log('[AutoSync] Mobile sync complete:', {
              timestamp: new Date().toISOString(),
              itemsSynced: totalSynced,
              remaining: totalRemaining,
              results: results.map(r => ({ success: r?.success || 0, failed: r?.failed || 0, remaining: r?.remaining || 0 })),
            });
          }
          
          // Only show success toast if items were actually synced
          if (anySuccess) {
            const remainingMsg = totalRemaining > 0 ? ` (${totalRemaining} more queued)` : '';
            toast.success(`Data synced successfully (${totalSynced} items)${remainingMsg}`);
            addSyncNotification(`Data synced successfully (${totalSynced} items)${remainingMsg}`);
          }
          
          // Always emit sync complete event for Dashboard to reload data (clears error states)
          emitSyncComplete();
          
          // iOS: Clear pending sync flags after successful sync (fixes N3 - storage accumulation)
          if (isIOSDevice) {
            clearPendingSyncs();
          }
          
          // ACCELERATED RE-SYNC: If items remain in queue, schedule next cycle sooner
          // This drains large queues (e.g., 22 items) in ~25s instead of waiting for the full interval
          if (totalRemaining > 0) {
            if (import.meta.env.DEV) {
              console.log(`[AutoSync] ${totalRemaining} items remaining - scheduling accelerated sync in ${ACCELERATED_SYNC_DELAY / 1000}s`);
            }
            // Reset the min sync interval guard so the accelerated sync can proceed
            lastSyncAttemptRef.current = Date.now() - MIN_SYNC_INTERVAL + ACCELERATED_SYNC_DELAY;
            setTimeout(() => {
              if (navigator.onLine && !syncInProgressRef.current) {
                performSync(true);
              }
            }, ACCELERATED_SYNC_DELAY);
          }
        } else {
          // All fetches timed out - don't report success, will retry next cycle
          console.warn('[AutoSync] All IndexedDB fetches timed out - not reporting success');
        }
      }
    } catch (error: any) {
      console.error('[AutoSync] Sync failed:', error);
      clearTimeout(safetyTimeoutHandle);
      
      // Show explicit error toast for sync failures (bypass mobile notification center for visibility)
      // Import toast from 'sonner' at the top (already imported via addSyncNotification usage)
      if (isMobileDevice) {
        addSyncNotification(`Sync failed: ${error?.message || 'will retry automatically'}`);
      }
      // Desktop toast is not needed here since errors are usually transient and auto-retry handles them
    } finally {
      syncInProgressRef.current = false;
      // CRITICAL: Always reset isSyncing state in finally block to prevent stuck spinner
      setState(prev => ({ ...prev, isSyncing: false }));
    }
  }, [queryClient, isMobileDevice, isIOSDevice]);
  
  /**
   * Update unsynced counts from IndexedDB - uses cached auth
   */
  const updateUnsyncedCounts = useCallback(async () => {
    try {
      const user = await getUserWithCache();
      if (!user) return;
      
      const [inspections, trainings, assessments] = await Promise.all([
        getUnsyncedInspections(user.id),
        getUnsyncedTrainings(user.id),
        getUnsyncedDailyAssessments(user.id),
      ]);
      
      const total = inspections.length + trainings.length + assessments.length;
      
      setState(prev => ({
        ...prev,
        unsyncedCount: total,
      }));
      
      if (import.meta.env.DEV && total > 0) {
        console.log('[AutoSync] Unsynced count:', total);
      }
    } catch (error) {
      console.error('[AutoSync] Error updating unsynced counts:', error);
    }
  }, []);
  
  /**
   * Debounced sync trigger - call this after local data changes
   */
  const triggerDebouncedSync = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    debounceTimerRef.current = setTimeout(() => {
      performSync(true);
    }, DEBOUNCE_DELAY);
  }, [performSync]);
  
  /**
   * Handle online event - sync immediately when network reconnects
   */
  const handleOnline = useCallback(async () => {
    if (import.meta.env.DEV) {
      console.log('[AutoSync] Network reconnected - checking offline auth then syncing');
    }
    
    // Verify offline credentials before syncing to prevent RLS failures
    if (hasPendingOfflineAuth()) {
      try {
        await verifyAndReconcileOfflineAuth();
      } catch (e) {
        console.warn('[AutoSync] Offline auth verification failed:', e);
        // Don't block sync - data is still local
      }
    }
    
    performSync(false);
  }, [performSync]);
  
  /**
   * Handle visibility change - sync when app becomes visible
   */
  const handleVisibilityChange = useCallback(() => {
    if (!document.hidden && navigator.onLine) {
      if (import.meta.env.DEV) {
        console.log('[AutoSync] App became visible - syncing');
      }
      performSync(true);
    }
  }, [performSync]);
  
  /**
   * Handle Realtime database changes from other devices
   */
  const handleRemoteChange = useCallback((payload: any) => {
    if (import.meta.env.DEV) {
      console.log('[AutoSync] Realtime change detected:', payload.eventType, payload.table);
    }
    
    // Invalidate relevant queries to refresh UI with remote data
    if (payload.table === 'inspections') {
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
    } else if (payload.table === 'trainings') {
      queryClient.invalidateQueries({ queryKey: ['trainings'] });
    } else if (payload.table === 'daily_assessments') {
      queryClient.invalidateQueries({ queryKey: ['daily-assessments'] });
    }
    
    // Trigger a sync to reconcile any local changes
    triggerDebouncedSync();
  }, [queryClient, triggerDebouncedSync]);
  
  // Initialize sync system
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[AutoSync] Initializing automatic sync system', {
        isMobile: isMobileDevice,
        isIOS: isIOSDevice,
      });
    }
    
    // PERFORMANCE: Defer initial sync to not block UI render
    // Dashboard data loads from Supabase directly, sync is for reconciliation
    const initialSyncTimer = setTimeout(() => {
      if (navigator.onLine) {
        performSync(true);
      }
      updateUnsyncedCounts();
    }, INITIAL_SYNC_DELAY);
    
    // Event listeners
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // iOS-specific: Handle page show (back/forward cache restore)
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && navigator.onLine) {
        if (import.meta.env.DEV) {
          console.log('[AutoSync] Page restored from bfcache - syncing');
        }
        performSync(true);
      }
    };
    
    if (isIOSDevice) {
      window.addEventListener('pageshow', handlePageShow);
      window.addEventListener('focus', () => {
        if (navigator.onLine) performSync(true);
      });
    }
    
    // Periodic sync polling with mobile-aware interval
    periodicSyncIntervalRef.current = setInterval(() => {
      if (!document.hidden && navigator.onLine) {
        performSync(true);
      }
    }, syncInterval);
    
    if (import.meta.env.DEV) {
      console.log('[AutoSync] Initialized with interval:', syncInterval / 1000, 's (mobile viewport:', isMobileViewport, ')');
    }
    
    // Realtime subscriptions for multi-device sync
    channelRef.current = supabase
      .channel('global-auto-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'inspections' },
        handleRemoteChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trainings' },
        handleRemoteChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_assessments' },
        handleRemoteChange
      )
      .subscribe((status) => {
        if (import.meta.env.DEV) {
          console.log('[AutoSync] Realtime subscription status:', status);
        }
      });
    
    return () => {
      // Cleanup
      clearTimeout(initialSyncTimer);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      
      if (isIOSDevice) {
        window.removeEventListener('pageshow', handlePageShow);
      }
      
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      
      if (periodicSyncIntervalRef.current) {
        clearInterval(periodicSyncIntervalRef.current);
      }
      
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [performSync, handleOnline, handleVisibilityChange, handleRemoteChange, updateUnsyncedCounts, isIOSDevice, isMobileDevice, syncInterval, isMobileViewport]);
  
  // Periodically update unsynced counts
  useEffect(() => {
    const interval = setInterval(updateUnsyncedCounts, 30000);
    return () => clearInterval(interval);
  }, [updateUnsyncedCounts]);
  
  return {
    ...state,
    triggerDebouncedSync,
    updateUnsyncedCounts,
    performSync,
  };
};
