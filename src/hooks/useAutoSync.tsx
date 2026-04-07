import { useEffect, useCallback, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { syncAllInspectionsAtomic, syncAllTrainingsAtomic, syncAllDailyAssessmentsAtomic } from '@/lib/atomic-sync-manager';
import { syncPhotos } from '@/lib/sync-manager';
import { getUnsyncedInspections, getUnsyncedTrainings, getUnsyncedDailyAssessments, getUnsyncedCounts, getCircuitBreakerStatus, pruneOldSyncedPhotoBlobs } from '@/lib/offline-storage';
import { getUserWithCache, getCachedUserFromStorage, ensureValidSession, type CachedUser } from '@/lib/cached-auth';
import { hasPendingOfflineAuth, verifyAndReconcileOfflineAuth } from '@/lib/offline-auth';
import { useQueryClient } from '@tanstack/react-query';
import { isMobile, isIOS } from '@/lib/mobile-detection';
import { useIsMobile } from '@/hooks/use-mobile';
import { addSyncNotification } from '@/lib/notification-center';
import { emitSyncComplete, setSyncInProgress } from '@/lib/sync-events';
import { clearPendingSyncs } from '@/lib/background-sync';
import { toast } from '@/components/ui/sonner';
import { markSnapshotSynced } from '@/lib/local-backup-ledger';

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
const STALE_UPLOAD_THRESHOLD = 5 * 60 * 1000; // 5 minutes - warn if data hasn't synced
const STALE_CHECK_INTERVAL = 60 * 1000; // Check every 60 seconds
const POST_SYNC_COOLDOWN = 10000; // 10s cooldown after sync completes to ignore self-triggered Realtime events

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
  unsyncedInspections: any[];
  unsyncedTrainings: any[];
  unsyncedAssessments: any[];
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
    unsyncedInspections: [],
    unsyncedTrainings: [],
    unsyncedAssessments: [],
  });
  
  // Refs for debouncing and preventing duplicate syncs
  const lastSyncAttemptRef = useRef<number>(0);
  const syncInProgressRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const periodicSyncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const staleWarningShownRef = useRef(false);
  const lastSyncCompletedAtRef = useRef<number>(0);
  const realtimeErrorCountRef = useRef<number>(0);
  
  /**
   * Perform the actual sync operation
   */
  // Ref to track unsyncedCount for use inside performSync (avoids stale closure)
  const unsyncedCountRef = useRef(state.unsyncedCount);
  useEffect(() => {
    unsyncedCountRef.current = state.unsyncedCount;
  }, [state.unsyncedCount]);

  const performSync = useCallback(async (silent = true) => {
    // Block all writes in Lovable preview to protect production data
    if ((await import('@/lib/environment')).isLovablePreview()) return;
    // Skip if offline
    if (!navigator.onLine) {
      if (import.meta.env.DEV) {
        console.log('[AutoSync] Offline - skipping sync');
      }
      return;
    }

    // Skip sync when circuit breaker is open to avoid hammering a broken IndexedDB
    const cbStatus = getCircuitBreakerStatus();
    if (cbStatus.open) {
      if (import.meta.env.DEV) {
        console.log('[AutoSync] Circuit breaker open - skipping sync cycle');
      }
      return;
    }
    
    // Quick sync gate — no network call needed to reject unauthenticated state
    const cachedUser = getCachedUserFromStorage();
    if (!cachedUser) {
      if (import.meta.env.DEV) {
        console.log('[AutoSync] No cached user session - skipping sync');
      }
      return;
    }
    
    // Single session validation for the entire sync cycle
    // This eliminates 3 redundant LockManager calls (one per atomic sync function)
    let validatedUser: CachedUser | null = null;
    try {
      validatedUser = await Promise.race([
        ensureValidSession(),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 5000))
      ]);
    } catch (e) {
      console.warn('[AutoSync] Session validation timed out, skipping sync');
      return;
    }
    if (!validatedUser) {
      console.warn('[AutoSync] No valid session, skipping sync');
      return;
    }
    
    // Prevent duplicate sync calls
    if (syncInProgressRef.current) {
      if (import.meta.env.DEV) {
        console.log('[AutoSync] Sync already in progress - skipping');
      }
      // Return a promise that resolves when current sync completes
      return new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (!syncInProgressRef.current) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 500);
        // Safety: resolve after 15s regardless (reduced from 35s to prevent long hangs)
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 15000);
      });
    }
    
    // Debounce protection — schedule deferred retry for explicit reconnection syncs
    const now = Date.now();
    if (now - lastSyncAttemptRef.current < MIN_SYNC_INTERVAL) {
      if (!silent) {
        // Explicit reconnection (online event) — don't silently drop, schedule retry
        const remaining = MIN_SYNC_INTERVAL - (now - lastSyncAttemptRef.current);
        if (import.meta.env.DEV) {
          console.log(`[AutoSync] Debounce guard hit on reconnection — scheduling retry in ${remaining}ms`);
        }
        setTimeout(() => {
          if (navigator.onLine && !syncInProgressRef.current) {
            performSync(false);
          }
        }, remaining + 500);
      } else if (import.meta.env.DEV) {
        console.log('[AutoSync] Too soon since last sync - debouncing');
      }
      return;
    }
    
    lastSyncAttemptRef.current = now;
    syncInProgressRef.current = true;
    setSyncInProgress(true);
    setState(prev => ({ ...prev, isSyncing: true }));
    
    // Calculate dynamic timeout based on BATCH size (not total unsynced)
    // With MAX_BATCH_SIZE=5: 30s + (5 x 8s) = 70s -- well within safe limits
    const batchSize = Math.min(unsyncedCountRef.current, MAX_BATCH_SIZE);
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
        console.log('[AutoSync] Starting sync...', { unsyncedCount: unsyncedCountRef.current, timeout: dynamicTimeout });
      }
      
      // Sync data types SEQUENTIALLY with UI thread yields between each
      // This prevents sync from blocking typing and other user interactions
      const yieldToUI = () => new Promise<void>(r => setTimeout(r, 0));
      
      const syncResult = await withSyncTimeout(
        (async () => {
          // Process any queued offline soft-deletes before main sync
          try {
            const { processQueuedSoftDeletes } = await import('@/lib/queued-soft-delete-processor');
            const deleteResult = await processQueuedSoftDeletes();
            if (deleteResult.processed > 0) {
              console.log(`[AutoSync] Processed ${deleteResult.processed} queued soft-deletes`);
            }
          } catch (e) {
            console.warn('[AutoSync] Queued soft-delete processing failed (non-blocking):', e);
          }
          await yieldToUI();

          const inspResult = await syncAllInspectionsAtomic(validatedUser).catch(e => { console.error('[AutoSync] Inspections sync failed:', e); return null; });
          await yieldToUI();
          const trainResult = await syncAllTrainingsAtomic(validatedUser).catch(e => { console.error('[AutoSync] Trainings sync failed:', e); return null; });
          await yieldToUI();
          const assessResult = await syncAllDailyAssessmentsAtomic(validatedUser).catch(e => { console.error('[AutoSync] Assessments sync failed:', e); return null; });
          await yieldToUI();
          const photoResult = await syncPhotos().catch(e => { console.error('[AutoSync] Photos sync failed:', e); return null; });
          return [inspResult, trainResult, assessResult, photoResult];
        })(),
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
          
          // Update photo count for useUnsyncedPhotos (no longer polls independently)
          window.dispatchEvent(new CustomEvent('sync-photos-updated'));
          
          // Hybrid cleanup: prune old synced photo blobs (non-blocking)
          pruneOldSyncedPhotoBlobs().catch(() => {});
          
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
            
            // Reset stale warning flag on successful sync
            staleWarningShownRef.current = false;
            
            // BUILD_TIMESTAMP audit logging for production diagnostics
            console.log('[AutoSync] Sync confirmed', {
              version: import.meta.env.APP_VERSION,
              build: import.meta.env.BUILD_TIMESTAMP,
              itemsSynced: totalSynced,
              remaining: totalRemaining,
              timestamp: new Date().toISOString(),
            });
          }
          
          // Only emit sync complete when items were actually synced
          // Prevents reload loop when all syncs are skipped due to session timeouts
          if (anySuccess) {
            emitSyncComplete();
            
            // Finding 7: Update localStorage backup ledger sync status
            // Mark all previously-unsynced snapshots as synced to keep backup ledger accurate
            try {
              const { listAllSnapshots } = await import('@/lib/local-backup-ledger');
              const snapshots = listAllSnapshots();
              for (const snap of snapshots) {
                if (!snap.synced) {
                  markSnapshotSynced(snap.reportType, snap.reportId);
                }
              }
            } catch (e) {
              // Non-critical — backup ledger sync status is cosmetic
              if (import.meta.env.DEV) console.warn('[AutoSync] Failed to update backup ledger sync status:', e);
            }
          }
          
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
      setSyncInProgress(false);
      lastSyncCompletedAtRef.current = Date.now();
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
      
      // Use batched read — single IndexedDB transaction instead of 3 separate calls
      const counts = await getUnsyncedCounts(user.id);
      
      const total = counts.inspections.length + counts.trainings.length + counts.assessments.length;
      
      setState(prev => ({
        ...prev,
        unsyncedCount: total,
        unsyncedInspections: counts.inspections,
        unsyncedTrainings: counts.trainings,
        unsyncedAssessments: counts.assessments,
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
      console.log('[AutoSync] Network reconnected - refreshing session then syncing');
    }
    
    // Pre-refresh session BEFORE sync to ensure fresh JWT
    // This eliminates race conditions between getUserWithCache and ensureValidSession
    try {
      const refreshResult = await Promise.race([
        supabase.auth.refreshSession(),
        new Promise<{ error: { message: string } }>((resolve) =>
          setTimeout(() => resolve({ error: { message: 'Session refresh timeout' } }), 5000)
        ),
      ]);
      if ('error' in refreshResult && refreshResult.error) {
        console.warn('[AutoSync] Session refresh failed:', refreshResult.error.message);
      } else if (import.meta.env.DEV) {
        console.log('[AutoSync] Session refreshed successfully');
      }
    } catch (e) {
      console.warn('[AutoSync] Session refresh error:', e);
    }
    
    // Verify offline credentials before syncing to prevent RLS failures
    if (hasPendingOfflineAuth()) {
      try {
        await verifyAndReconcileOfflineAuth();
      } catch (e) {
        console.warn('[AutoSync] Offline auth verification failed:', e);
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
    
    // Only trigger sync if we're NOT currently syncing -- prevents the loop where
    // align_synced_at RPC fires a Realtime UPDATE that re-triggers sync
    if (!syncInProgressRef.current) {
      // Skip if a sync just completed within the extended cooldown window
      // This prevents self-triggered Realtime events (from our own writes) from
      // causing unnecessary IndexedDB reads and redundant syncs
      const msSinceLastComplete = Date.now() - lastSyncCompletedAtRef.current;
      const msSinceLastAttempt = Date.now() - lastSyncAttemptRef.current;
      if (msSinceLastComplete < POST_SYNC_COOLDOWN) {
        if (import.meta.env.DEV) {
          console.log('[AutoSync] Skipping Realtime-triggered sync (post-sync cooldown)', { msSinceLastComplete });
        }
      } else if (msSinceLastAttempt > MIN_SYNC_INTERVAL) {
        triggerDebouncedSync();
      } else if (import.meta.env.DEV) {
        console.log('[AutoSync] Skipping Realtime-triggered sync (min interval cooldown)', { msSinceLastAttempt });
      }
    } else if (import.meta.env.DEV) {
      console.log('[AutoSync] Skipping Realtime-triggered sync (sync in progress)');
    }
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
    
    // RC-4: iOS page restore — refresh session before syncing (same as handleOnline)
    const handlePageShow = async (event: PageTransitionEvent) => {
      if (event.persisted && navigator.onLine) {
        if (import.meta.env.DEV) {
          console.log('[AutoSync] Page restored from bfcache - refreshing session then syncing');
        }
        // Pre-refresh session before sync to ensure fresh JWT after bfcache restore
        try {
          await Promise.race([
            supabase.auth.refreshSession(),
            new Promise<void>((resolve) => setTimeout(resolve, 5000)),
          ]);
        } catch (e) {
          console.warn('[AutoSync] Session refresh on pageshow failed:', e);
        }
        performSync(true);
      }
    };
    
    // RC-2: Gate iOS focus handler behind MIN_SYNC_INTERVAL debounce
    const handleFocus = () => {
      if (navigator.onLine) {
        const now = Date.now();
        if (now - lastSyncAttemptRef.current >= MIN_SYNC_INTERVAL) {
          performSync(true);
        } else if (import.meta.env.DEV) {
          console.log('[AutoSync] Focus event debounced (too soon since last sync)');
        }
      }
    };
    
    if (isIOSDevice) {
      window.addEventListener('pageshow', handlePageShow as EventListener);
      window.addEventListener('focus', handleFocus);
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
        // RC-6: Backoff on repeated channel errors — unsubscribe after 3 consecutive errors
        if (status === 'CHANNEL_ERROR') {
          realtimeErrorCountRef.current++;
          if (realtimeErrorCountRef.current >= 3 && channelRef.current) {
            console.warn('[AutoSync] 3+ consecutive CHANNEL_ERRORs — unsubscribing to prevent reconnect storms. Relying on periodic polling.');
            supabase.removeChannel(channelRef.current);
            channelRef.current = null;
          }
        } else if (status === 'SUBSCRIBED') {
          realtimeErrorCountRef.current = 0;
        }
      });
    
    return () => {
      // Cleanup
      clearTimeout(initialSyncTimer);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      
      if (isIOSDevice) {
        window.removeEventListener('pageshow', handlePageShow as EventListener);
        window.removeEventListener('focus', handleFocus);
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
  
  // RC-2: Removed separate 30s updateUnsyncedCounts interval
  // Unsynced counts are now updated inside the main periodic sync loop (line 262)
  // and on initial mount (line 508), reducing concurrent IndexedDB access on Safari
  
  // Stale upload detection: warn if items haven't synced for 5+ minutes while online
  useEffect(() => {
    const checkStale = () => {
      if (!navigator.onLine) return;
      if (unsyncedCountRef.current === 0) {
        staleWarningShownRef.current = false;
        return;
      }
      
      const lastSync = state.lastSyncTime?.getTime() || 0;
      const elapsed = Date.now() - lastSync;
      
      if (elapsed > STALE_UPLOAD_THRESHOLD && !staleWarningShownRef.current) {
        staleWarningShownRef.current = true;
        toast.warning(`${unsyncedCountRef.current} item(s) haven't synced in over 5 minutes`, {
          description: 'Check your connection or try force-syncing.',
          duration: 10000,
        });
        addSyncNotification(`Stale upload warning: ${unsyncedCountRef.current} items pending for 5+ minutes`);
      }
    };
    
    const interval = setInterval(checkStale, STALE_CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [state.lastSyncTime]);
  
  return {
    ...state,
    triggerDebouncedSync,
    updateUnsyncedCounts,
    performSync,
  };
};
