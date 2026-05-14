import { useEffect, useCallback, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { syncAllInspectionsAtomic, syncAllTrainingsAtomic, syncAllDailyAssessmentsAtomic, noteBatchOutcome, refetchInspectionPackage, refetchTrainingPackage, refetchAssessmentPackage } from '@/lib/atomic-sync-manager';
import { flushAdminEditQueue } from '@/lib/admin-edit-snapshot-queue';
import { logError } from '@/lib/log-error';
import { syncPhotos } from '@/lib/sync-manager';
import { ingestRemoteRecordOffline } from '@/lib/offline-storage';
import { shouldPreserveLocalRecord } from '@/lib/local-data-guards';
import { getUnsyncedInspections, getUnsyncedTrainings, getUnsyncedDailyAssessments, isIdbReadFailure, getCircuitBreakerStatus, resetCircuitBreaker, pruneOldSyncedPhotoBlobs, getQueuedOperations, removeQueuedOperation, getQueuedTrainingOperations, removeQueuedTrainingOperation, getQueuedAssessmentOperations, removeQueuedAssessmentOperation, withIDBTimeout, evictStuckTempPhotos, maybeRunQuarantineGc, subscribeToLayerBreakerClose, type DbRow } from '@/lib/offline-storage';
// Audit M2: static-import the autosync drain modules so the cycle isn't gated
// on a Vite-emitted lazy chunk that can fail to fetch on a flaky-Wi-Fi iPad.
// Each was previously `await import(...)` on the post-sync hot path; the
// dynamic-import failure mode silently regressed queue prune / temp-photo
// eviction / storage-pressure work to "never runs," accumulating dead state.
// Mirrors the H1 + P3 + #18 + #82 static-import hardening pattern.
import { processQueuedSoftDeletes, pruneCompletedQueuedOperations } from '@/lib/queued-soft-delete-processor';
import { manageStoragePressure } from '@/lib/storage-pressure-manager';
import { maybeRunCycleProbe } from '@/lib/storage-rls-probe';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { getUserWithCache, getCachedUserFromStorage, ensureValidSession, getLocallyValidCachedUser, type CachedUser } from '@/lib/cached-auth';
import { hasPendingOfflineAuth, verifyAndReconcileOfflineAuth } from '@/lib/offline-auth';
import { useQueryClient } from '@tanstack/react-query';
import { isMobile, isIOS } from '@/lib/mobile-detection';
import { useIsMobile } from '@/hooks/use-mobile';
import { addSyncNotification } from '@/lib/notification-center';
import { emitSyncComplete, setSyncInProgress, isRecentSelfWrite, isActiveFormRecord, emitPendingRemoteUpdate, type ActiveFormTable } from '@/lib/sync-events';
import { clearPendingSyncs } from '@/lib/background-sync';
import { toast } from '@/components/ui/sonner';
import { markSnapshotSynced } from '@/lib/local-backup-ledger';
import { isRestoreInProgress, onRestoreLockChange } from '@/lib/restore-lock';
import { syncLog } from '@/lib/sync-logger';
import { scanForStuckPhotos } from '@/lib/stuck-photo-beacon';
import { recordSyncHalt, clearSyncHalt } from '@/lib/sync-halt-tracker';
import { maybeRunPhotoRescueSweep } from '@/lib/photo-rescue-sweep';
import {
  isDrainModeActive,
  subscribeDrainMode,
  registerDrainRunner,
  DRAIN_SYNC_INTERVAL_MS,
} from '@/lib/drain-mode';

/**
 * Result returned by each per-table atomic-sync helper
 * (`syncAllInspectionsAtomic`, `syncAllTrainingsAtomic`,
 * `syncAllDailyAssessmentsAtomic`). Photos use the same shape via
 * `syncPhotos`. `total === -1` is the sentinel for "fetch failed due to
 * timeout" (see `withSyncTimeout` callers); a result is null when the
 * helper threw or skipped.
 */
type TableSyncResult = {
  total: number;
  success: number;
  failed: number;
  remaining?: number;
  changed?: number;
  errors?: unknown[];
};

// Sync configuration with mobile optimization
// Tuned for fast user-driven sync (S5/S6/S7) — duplicate prevention is handled by syncInProgressRef
const DEBOUNCE_DELAY = 1500; // 1.5s after local changes (was 3s) — matches AUTO_SAVE_DEBOUNCE_MS
const ONLINE_HANDLER_DEBOUNCE = 1500; // S33: coalesce online-event flaps so flaky networks don't stack session refreshes
const DESKTOP_SYNC_INTERVAL = 30000; // 30 seconds for desktop
const DESKTOP_IDLE_SYNC_INTERVAL = 120000; // 120 seconds when idle (no unsynced items)
const MOBILE_SYNC_INTERVAL = 60000; // 60 seconds for mobile (reduced from 5min for faster sync)
const MOBILE_IDLE_SYNC_INTERVAL = 180000; // 180 seconds when idle on mobile
// Adaptive boost: when the tab is foreground+online AND there is pending data,
// poll faster than the normal "active" cadence. This shrinks the window where
// an iPad Safari user is staring at a stuck "N pending" badge waiting for the
// next 60s tick. Battery cost is bounded — only fires while the user is
// looking at the app AND there's actually something to push.
const MOBILE_PENDING_VISIBLE_INTERVAL = 10000;  // 10s
const DESKTOP_PENDING_VISIBLE_INTERVAL = 5000;  // 5s
const MIN_SYNC_INTERVAL = 2000; // Minimum 2s between syncs (was 5s) — anti-thrash floor
const INITIAL_SYNC_DELAY = 500; // 500ms initial sync delay (was 2s) — UI is paint-stable by then
const BASE_SYNC_TIMEOUT = 30000; // Base 30 second timeout
const PER_ITEM_TIMEOUT_BUDGET = 8000; // 8 seconds budget per unsynced item
const MAX_SYNC_TIMEOUT = 300000; // 5 minute absolute maximum
// Per-device batch size: mobile stays conservative; desktop drains backlogs faster.
// Mirrors the mobile/desktop split used by syncPhotos in sync-manager.ts.
const MAX_BATCH_SIZE = isMobile() ? 5 : 15;
const ACCELERATED_SYNC_DELAY = 1000; // 1s between cycles when draining a queue (was 5s)
const STALE_UPLOAD_THRESHOLD = 5 * 60 * 1000; // 5 minutes - warn if data hasn't synced
const STALE_CHECK_INTERVAL = 60 * 1000; // Check every 60 seconds
const POST_SYNC_COOLDOWN = 10000; // 10s cooldown after sync completes to ignore self-triggered Realtime events

/**
 * Helper to wrap promises with a timeout
 * Returns { result, timedOut } to differentiate between timeout and successful null
 */
function withSyncTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<{ result: T | null; timedOut: boolean }> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout>;

  // H5: forward an external abort (e.g. visibility-hidden) so we don't keep
  // stuck Promise.race wrappers alive while the tab is backgrounded.
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timeoutPromise = new Promise<{ result: null; timedOut: true }>((resolve) => {
    timeoutHandle = setTimeout(() => {
      console.warn('[AutoSync] Sync operation timed out after', timeoutMs, 'ms — aborting in-flight work');
      controller.abort();
      resolve({ result: null, timedOut: true });
    }, timeoutMs);
  });

  const wrappedPromise = run(controller.signal).then(
    (result) => {
      clearTimeout(timeoutHandle);
      externalSignal?.removeEventListener('abort', onExternalAbort);
      return { result, timedOut: false as const };
    },
    (err) => {
      clearTimeout(timeoutHandle);
      externalSignal?.removeEventListener('abort', onExternalAbort);
      // Aborts surface as AbortError — treat as a timed-out skip rather than a hard failure
      if (err?.name === 'AbortError') {
        return { result: null, timedOut: true as const };
      }
      throw err;
    }
  );

  return Promise.race([wrappedPromise, timeoutPromise]);
}

export interface AutoSyncState {
  isSyncing: boolean;
  lastSyncTime: Date | null;
  unsyncedCount: number;
  unsyncedPhotoCount: number;
  unsyncedInspections: DbRow[];
  unsyncedTrainings: DbRow[];
  unsyncedAssessments: DbRow[];
  // S11: surfaces IDB read failures so the badge keeps last-known counts
  // and the user gets a real error instead of a silent 0.
  syncError: string | null;
  // S42 (Fix F): severity of syncError. 'fatal' = pipeline crashed, show red SYNC FAILED.
  // 'soft' = stats-refresh hiccup (Fix C path) or photo-counts read failure — sync itself
  // is fine, just show an amber advisory in the terminal. null when no error.
  syncErrorSeverity: 'fatal' | 'soft' | null;
}

/**
 * Unified hook for fully automatic background synchronization
 */
export const useAutoSync = () => {
  const queryClient = useQueryClient();
  const isMobileDevice = isMobile();
  const isIOSDevice = isIOS();
  const isMobileViewport = useIsMobile();
  
  const activeSyncInterval = isMobileViewport ? MOBILE_SYNC_INTERVAL : DESKTOP_SYNC_INTERVAL;
  const idleSyncInterval = isMobileViewport ? MOBILE_IDLE_SYNC_INTERVAL : DESKTOP_IDLE_SYNC_INTERVAL;
  
  const [state, setState] = useState<AutoSyncState>({
    isSyncing: false,
    lastSyncTime: null,
    unsyncedCount: 0,
    unsyncedPhotoCount: 0,
    unsyncedInspections: [],
    unsyncedTrainings: [],
    unsyncedAssessments: [],
    syncError: null,
    syncErrorSeverity: null,
  });
  
  // Refs for debouncing and preventing duplicate syncs
  const lastSyncAttemptRef = useRef<number>(0);
  const syncInProgressRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onlineHandlerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const periodicSyncIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const staleWarningShownRef = useRef(false);
  const lastSyncCompletedAtRef = useRef<number>(0);
  const realtimeErrorCountRef = useRef<number>(0);
  const realtimeReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeBackoffRef = useRef<number>(60000); // Start at 60s, doubles up to 300s cap
  // H1: throttle for resume-triggered Realtime resubscribes. iOS Safari kills
  // suspended websockets without firing CHANNEL_ERROR, so the only way to
  // recover after bfcache restore / tab return / network handoff is to tear
  // down + recreate on app-resume signals (pageshow / visibilitychange→visible
  // / focus / online). The throttle prevents thrash if the user tabs around
  // quickly — a 30s window is well under the typical 2–5min idle that
  // actually kills the websocket.
  const lastRealtimeResubscribeAtRef = useRef<number>(0);
  // S12: Per-id debounced full-package refetch on Realtime parent events.
  // Coalesces bursts of UPDATEs to the same record into one refetch (~300ms window).
  const refetchTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const REFETCH_DEBOUNCE_MS = 300;
  // S21: Shared completion promise for the in-flight sync run.
  // Concurrent callers await this directly instead of polling syncInProgressRef.
  const inFlightSyncRef = useRef<Promise<void> | null>(null);
  // H5: external abort for the active sync run. Triggered on visibility-hidden
  // so backgrounded tabs stop holding open Promise.race wrappers / timers.
  const activeSyncAbortRef = useRef<AbortController | null>(null);
  
  /**
   * Perform the actual sync operation
   */
  // Ref to track unsyncedCount for use inside performSync (avoids stale closure)
  const unsyncedCountRef = useRef(state.unsyncedCount);
  useEffect(() => {
    unsyncedCountRef.current = state.unsyncedCount;
  }, [state.unsyncedCount]);

  // S43 (Fix G): 3-strike silent-failure detector. When sync cycles complete
  // with zero successes AND there are still pending items AND nothing failed
  // explicitly, the most likely cause is a silently-expired JWT (cached path
  // 7C). Three cycles like this in a row → force refreshSession() and surface
  // a fatal error so the user knows to re-authenticate.
  const zeroProgressStreakRef = useRef(0);
  const lastForcedRefreshAtRef = useRef(0);
  const FORCED_REFRESH_COOLDOWN_MS = 60_000;

  const performSync = useCallback(async (silent = true) => {
    // S34: Track per-cycle photo state changes so we only dispatch
    // `sync-photos-updated` when something actually moved.
    let photoChangeCount = 0;
    // Block all writes in Lovable preview to protect production data
    if ((await import('@/lib/environment')).isLovablePreview()) return;
    // Skip if offline. Sprint 2 F: use `isLikelyOnline()` so a transient
    // `navigator.onLine=false` blip during iOS Safari Wi-Fi → cellular
    // handoff doesn't stall the sync engine for the full handoff window.
    // The grace branch returns `true` if any fetch round-tripped within
    // the last 30s, regardless of what the browser flag currently says.
    const { isLikelyOnline } = await import('@/lib/network-liveness');
    if (!isLikelyOnline()) {
              syncLog.log('[AutoSync] Offline - skipping sync');
      // Offline is already surfaced through `isOnline` in the badge; not
      // a halt class we need to record separately.
      return;
    }

    // H2: Restore-in-progress guard. The restore flow writes records with
    // synced_at=null; if a sync batch fires mid-restore the freshly-restored
    // rows can be clobbered by an in-flight T0 snapshot (see C4). The lock
    // is released by withRestoreLock(); a fresh sync is kicked off then.
    if (isRestoreInProgress()) {
              syncLog.log('[AutoSync] Restore in progress - skipping sync cycle');
      recordSyncHalt('restore_in_progress');
      return;
    }

    // Skip sync when circuit breaker is open to avoid hammering a broken IndexedDB
    const cbStatus = getCircuitBreakerStatus();
    if (cbStatus.open) {
      if (silent) {
                  syncLog.log('[AutoSync] Circuit breaker open - skipping background sync cycle');
        const resetIn = cbStatus.resetIn;
        recordSyncHalt('circuit_breaker_open', {
          autoResumeAt:
            typeof resetIn === 'number' && resetIn > 0
              ? Date.now() + resetIn
              : undefined,
        });
        return;
      }
      // Force sync: reset the circuit breaker so user action always works
      syncLog.log('[AutoSync] Circuit breaker open but force sync requested - resetting circuit breaker');
      resetCircuitBreaker();
    }

    // Quick sync gate — no network call needed to reject unauthenticated state
    const cachedUser = getCachedUserFromStorage();
    if (!cachedUser) {
              syncLog.log('[AutoSync] No cached user session - skipping sync');
      recordSyncHalt('no_session');
      return;
    }
    
    // Single session validation for the entire sync cycle
    // This eliminates 3 redundant LockManager calls (one per atomic sync function)
    //
    // Mode 7C — when `ensureValidSession()` is blocked by an unreachable
    // supabase REST endpoint (`Failed to fetch`) during the post-online
    // recovery window, fall back to the cached user as long as its JWT
    // is locally still valid. supabase becomes the authority on the actual
    // sync POST: a bad token 401s, then the H5-T classifier + atomic-sync
    // retry budget kick in (PRs #94/#101/#102). Without this fallback,
    // `performSync` silently no-ops for the entire window and the dirty
    // record sits in IDB until the next periodic sync tick after refresh
    // unblocks — typically minutes after the network returned.
    let validatedUser: CachedUser | null = null;
    try {
      validatedUser = await Promise.race([
        ensureValidSession(),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 8000))
      ]);
    } catch (e) {
      const fallback = getLocallyValidCachedUser();
      if (fallback) {
        console.warn('[AutoSync] Session validation timed out, using cached JWT fallback (Mode 7C)');
        validatedUser = fallback;
      } else {
        console.warn('[AutoSync] Session validation timed out, skipping sync');
        recordSyncHalt('auth_validation_timeout');
        return;
      }
    }
    if (!validatedUser) {
      const fallback = getLocallyValidCachedUser();
      if (fallback) {
        console.warn('[AutoSync] No valid session from refresh, using cached JWT fallback (Mode 7C)');
        validatedUser = fallback;
      } else {
        console.warn('[AutoSync] No valid session, skipping sync');
        recordSyncHalt('auth_no_valid_session');
        return;
      }
    }
    
    // S21: Await the in-flight sync directly instead of polling syncInProgressRef.
    // - Silent (background) callers: piggy-back on the in-flight run and return.
    // - User-initiated callers (silent=false): wait for it to finish, then run a
    //   fresh sync against post-sync state so the explicit tap is honored.
    if (syncInProgressRef.current && inFlightSyncRef.current) {
              syncLog.log('[AutoSync] Sync already in progress - awaiting in-flight run');
      try { await inFlightSyncRef.current; } catch {}
      if (!silent) {
        return performSync(false);
      }
      return;
    }
    
    // Debounce protection — only applies to background (silent) syncs.
    // Force sync (silent=false) bypasses debounce entirely; the syncInProgressRef
    // guard above already prevents true duplicate calls.
    const now = Date.now();
    if (silent && now - lastSyncAttemptRef.current < MIN_SYNC_INTERVAL) {
              syncLog.log('[AutoSync] Too soon since last sync - debouncing');
      return;
    }
    
    lastSyncAttemptRef.current = now;
    syncInProgressRef.current = true;
    setSyncInProgress(true);
    setState(prev => ({ ...prev, isSyncing: true }));

    // We've cleared every actionable silent-halt path; clear the surfaced
    // halt reason so the UI returns to a normal SYNCING state. If the cycle
    // discovers a fresh halt class (e.g. all IDB reads time out), the
    // post-cycle code below re-records it.
    clearSyncHalt();

    // S21: Create a deferred promise that resolves when this run's `finally` clears it.
    // Concurrent callers above await this directly instead of polling.
    let resolveInFlight: () => void = () => {};
    inFlightSyncRef.current = new Promise<void>((resolve) => {
      resolveInFlight = resolve;
    });
    
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
        setSyncInProgress(false);
        setState(prev => ({ ...prev, isSyncing: false }));
        // S21: unblock any awaiters piggy-backed on this run
        inFlightSyncRef.current = null;
        resolveInFlight();
      }
    }, dynamicTimeout + 2000); // 2 seconds after main timeout as final safety
    
    try {
      // H10: Flush any queued admin pre-edit snapshot intents BEFORE pushing
      // local edits to the server, so the snapshot reflects the server's
      // pre-edit state rather than the admin's overwrite.
      try {
        await flushAdminEditQueue();
      } catch (flushErr) {
        console.warn('[AutoSync] admin-edit-snapshot flush failed (non-blocking):', flushErr);
      }

      // Refresh real unsynced counts BEFORE deciding whether to skip the pipeline.
      // The in-memory ref can be stale (e.g. immediately after a save, or after an
      // IDB timeout returned 0). Trust a fresh IDB read instead.
      let liveUnsyncedCount = unsyncedCountRef.current;
      try {
        const freshUser = await getUserWithCache();
        if (freshUser) {
          // C2: Three parallel status-aware reads instead of the deleted
          // batched `getUnsyncedCounts`. Each read is wrapped in its own
          // timeout boundary AND returns `IdbReadFailure` on circuit-breaker
          // open / IDB error — so a failed read can never look like an
          // empty queue and zero the badge.
          const [inspRes, trainRes, assessRes] = await Promise.all([
            withIDBTimeout(
              'refreshUnsyncedInspections',
              'heavy',
              () => getUnsyncedInspections(freshUser.id),
              [] as DbRow[]
            ),
            withIDBTimeout(
              'refreshUnsyncedTrainings',
              'heavy',
              () => getUnsyncedTrainings(freshUser.id),
              [] as DbRow[]
            ),
            withIDBTimeout(
              'refreshUnsyncedDailyAssessments',
              'heavy',
              () => getUnsyncedDailyAssessments(freshUser.id),
              [] as DbRow[]
            ),
          ]);

          const anyTimedOut = inspRes.timedOut || trainRes.timedOut || assessRes.timedOut;
          const anyFailed =
            isIdbReadFailure(inspRes.data) ||
            isIdbReadFailure(trainRes.data) ||
            isIdbReadFailure(assessRes.data);

          if (anyTimedOut || anyFailed) {
            console.warn(
              '[AutoSync] Unsynced count read failed/timed out — preserving last-known counts, skipping this sync cycle',
              { anyTimedOut, anyFailed }
            );
            clearTimeout(safetyTimeoutHandle);
            syncInProgressRef.current = false;
            setSyncInProgress(false);
            setState(prev => ({ ...prev, isSyncing: false }));
            // S21: unblock awaiters
            inFlightSyncRef.current = null;
            resolveInFlight();
            return;
          }

          const freshCounts = {
            inspections: inspRes.data as DbRow[],
            trainings: trainRes.data as DbRow[],
            assessments: assessRes.data as DbRow[],
          };
          liveUnsyncedCount =
            freshCounts.inspections.length +
            freshCounts.trainings.length +
            freshCounts.assessments.length;
          if (liveUnsyncedCount !== unsyncedCountRef.current) {
            unsyncedCountRef.current = liveUnsyncedCount;
            setState(prev => ({
              ...prev,
              unsyncedCount: liveUnsyncedCount,
              unsyncedInspections: freshCounts.inspections,
              unsyncedTrainings: freshCounts.trainings,
              unsyncedAssessments: freshCounts.assessments,
            }));
          }
        }
      } catch (refreshErr) {
        console.warn('[AutoSync] Pre-sync count refresh failed (non-blocking):', refreshErr);
      }

              syncLog.log('[AutoSync] Starting sync...', { unsyncedCount: liveUnsyncedCount, timeout: dynamicTimeout });

      // EARLY EXIT: When nothing to sync, only clean stale queues and skip heavy pipeline
      const hasUnsyncedItems = liveUnsyncedCount > 0;
      let hasQueuedOps = false;
      
      if (!hasUnsyncedItems) {
        try {
          const [inspOps, trainOps, assessOps] = await Promise.all([
            getQueuedOperations(),
            getQueuedTrainingOperations(),
            getQueuedAssessmentOperations(),
          ]);
          hasQueuedOps = inspOps.length > 0 || trainOps.length > 0 || assessOps.length > 0;
          
          if (hasQueuedOps) {
            // Process any soft-delete entries first
            // Audit M2: `processQueuedSoftDeletes` is now a static import (file head).
            try {
              const deleteResult = await processQueuedSoftDeletes();
              if (deleteResult.processed > 0) {
                syncLog.log(`[AutoSync] Processed ${deleteResult.processed} queued soft-deletes`);
              }
              if (deleteResult.deadLettered > 0) {
                try {
                  const { toast } = await import('sonner');
                  toast.error(
                    `${deleteResult.deadLettered} deletion${deleteResult.deadLettered > 1 ? 's' : ''} failed permanently — see Sync Diagnostics`
                  );
                } catch { /* ignore */ }
              }
            } catch (e) {
              console.warn('[AutoSync] Queued soft-delete processing failed (non-blocking):', e);
            }
            
            // S4: Conservative state-aware prune (replaces destructive bulk-clear).
            // Only drops entries whose work is already represented in IDB state.
            // Audit M2: `pruneCompletedQueuedOperations` is now a static import (file head).
            try {
              const pruned = await pruneCompletedQueuedOperations();
              const total = pruned.inspections + pruned.trainings + pruned.assessments;
              if (total > 0) {
                syncLog.log(`[AutoSync] Pruned ${total} completed queued operations`, pruned);
              }
            } catch (e) {
              console.warn('[AutoSync] Non-blocking: queue prune failed:', e);
            }
          }
        } catch (e) {
          console.warn('[AutoSync] Stale queue check failed (non-blocking):', e);
        }
      }
      
      // If nothing to sync and no queued ops (or we just cleaned them), skip the heavy pipeline
      if (!hasUnsyncedItems && !hasQueuedOps) {
                  syncLog.log('[AutoSync] Nothing to sync - skipping pipeline');
        clearTimeout(safetyTimeoutHandle);
        // Always refresh counts so badge reflects reality (fixes stale badge after circuit breaker)
        updateUnsyncedCounts({ force: true }).catch(() => {});
        // S34: No work happened — skip the photo-count broadcast. The 5-min
        // safety tick in useUnsyncedPhotos handles any out-of-band drift.
        setState(prev => ({ ...prev, isSyncing: false, lastSyncTime: new Date() }));
        return;
      }
      
      // S1: Sync the three report types IN PARALLEL (independent table families, no shared rows).
      // Photos run AFTER report sync so the temp-ID → UUID swap (performed
      // during report sync) is in place before we try to upload. This is
      // best-effort: any photo whose parent is still `temp-…` at upload time
      // is skipped AND has its retryCount bumped (see sync-manager.ts /
      // syncPhotos, S13). After MAX_PHOTO_RETRIES (5) such cycles the photo
      // dead-letters and surfaces in SyncDiagnosticsSheet — it is not
      // silently re-queued forever.
      const yieldToUI = () => new Promise<void>(r => setTimeout(r, 0));

      // H5: install fresh abort controller for this run; visibility-hidden
      // handler aborts it so the tab stops holding stuck I/O.
      //
      // Mode 13B: do NOT pre-emptively abort `activeSyncAbortRef.current`
      // here. The previous run's controller can still be live (e.g. its
      // per-record retry backoff is mid-sleep, or runWithConcurrency is
      // draining one of its remaining slots) when the safety timeout at
      // the top of `performSync` force-resets `syncInProgressRef` without
      // also aborting the inner work. Calling `.abort()` here in that
      // window cascades down to `transaction-manager.withStepTimeout`
      // and surfaces as a fresh `AbortError: Step aborted: <op>:<table>`
      // mid-step (PR #129 CI trace, run 25297867x — `Step aborted:
      // update:inspections` at 02:58:00 immediately following an
      // overlapping-tick race). The error is classified transient by
      // the H5-T classifier so it doesn't quarantine the record, but
      // it eats one slot of the per-record retry budget — which then
      // exhausts faster than the underlying network outage clears.
      //
      // The gate at the top of `performSync` (`if (syncInProgressRef &&
      // inFlightSyncRef)`) already prevents normal overlap. The only
      // overlap path is the safety-timeout race described above; the
      // right fix is to *not* abort a still-live previous run, and let
      // it finish on its own (its outer withSyncTimeout owns a timeout
      // budget; its inner per-record loops own jittered backoff +
      // `maxRetries` budgets). The new run installs its own fresh
      // controller below; the old controller is GC'd once the old
      // run resolves.
      activeSyncAbortRef.current = new AbortController();
      const syncResult = await withSyncTimeout(
        async (signal) => {
          // Process any queued offline soft-deletes before main sync
          // Audit M2: `processQueuedSoftDeletes` is now a static import (file head).
          try {
            const deleteResult = await processQueuedSoftDeletes(signal);
            if (deleteResult.processed > 0) {
              syncLog.log(`[AutoSync] Processed ${deleteResult.processed} queued soft-deletes`);
            }
            if (deleteResult.deadLettered > 0) {
              try {
                const { toast } = await import('sonner');
                toast.error(
                  `${deleteResult.deadLettered} deletion${deleteResult.deadLettered > 1 ? 's' : ''} failed permanently — see Sync Diagnostics`
                );
              } catch { /* ignore */ }
            }
          } catch (e) {
            console.warn('[AutoSync] Queued soft-delete processing failed (non-blocking):', e);
          }
          if (signal.aborted) throw new DOMException('aborted', 'AbortError');
          await yieldToUI();

          // Run inspections / trainings / assessments concurrently — they touch independent tables
          const [inspSettled, trainSettled, assessSettled] = await Promise.allSettled([
            syncAllInspectionsAtomic(validatedUser, signal),
            syncAllTrainingsAtomic(validatedUser, signal),
            syncAllDailyAssessmentsAtomic(validatedUser, signal),
          ]);
          const inspResult = inspSettled.status === 'fulfilled' ? inspSettled.value : (console.error('[AutoSync] Inspections sync failed:', inspSettled.reason), null);
          const trainResult = trainSettled.status === 'fulfilled' ? trainSettled.value : (console.error('[AutoSync] Trainings sync failed:', trainSettled.reason), null);
          const assessResult = assessSettled.status === 'fulfilled' ? assessSettled.value : (console.error('[AutoSync] Assessments sync failed:', assessSettled.reason), null);
          if (signal.aborted) throw new DOMException('aborted', 'AbortError');
          await yieldToUI();
          // Photos depend on real UUIDs assigned by the report syncs above
          const photoResult = await syncPhotos(signal).catch(e => { console.error('[AutoSync] Photos sync failed:', e); return null; });
          return [inspResult, trainResult, assessResult, photoResult];
        },
        dynamicTimeout,
        activeSyncAbortRef.current?.signal
      );
      
      // Clear safety timeout since we completed normally
      clearTimeout(safetyTimeoutHandle);
      
      if (syncResult.timedOut) {
        console.warn('[AutoSync] Sync timed out - resetting state');
      } else         syncLog.log('[AutoSync] Sync completed successfully');
      
      // Update state - always reset isSyncing
      setState(prev => ({
        ...prev,
        isSyncing: false,
        lastSyncTime: syncResult.timedOut ? prev.lastSyncTime : new Date(),
      }));
      
      // Only do post-sync work if we didn't time out
      if (!syncResult.timedOut) {
        // Check if any sync actually happened or if all returned -1 (fetch failed due to timeout)
        const results = (syncResult.result as TableSyncResult[]) || [];
        const allFetchesFailed = results.length > 0 && results.every(r => r?.total === -1);
        if (allFetchesFailed) {
          // Every IDB read in the parallel pipeline timed out / errored —
          // counts are stale, no work moved. Surface to the user instead of
          // silently leaving "37 PENDING" stuck.
          recordSyncHalt('idb_reads_failed');
        }
        const anySuccess = results.some(r => r?.success > 0);
        const totalSynced = results.reduce((sum, r) => sum + (r?.success || 0), 0);
        const totalRemaining = results.reduce((sum, r) => sum + (r?.remaining || 0), 0);
        const totalFailed = results.reduce((sum, r) => sum + (r?.failed || 0), 0);
        const cleanSuccess = anySuccess && totalFailed === 0;

        // S43 (Fix G): silent-failure detector. Increment when a cycle moves
        // nothing despite work pending; reset on any progress.
        const totalReportRemaining = results.slice(0, 3).reduce((sum, r) => sum + (r?.remaining || 0), 0);
        const photoRemaining = results[3]?.remaining || 0;
        const hadPendingWork = totalReportRemaining + photoRemaining > 0 || unsyncedCountRef.current > 0;
        if (!allFetchesFailed && totalSynced === 0 && totalFailed === 0 && hadPendingWork) {
          zeroProgressStreakRef.current += 1;
        } else if (totalSynced > 0) {
          zeroProgressStreakRef.current = 0;
        }
        if (zeroProgressStreakRef.current >= 3) {
          const now = Date.now();
          if (now - lastForcedRefreshAtRef.current > FORCED_REFRESH_COOLDOWN_MS) {
            lastForcedRefreshAtRef.current = now;
            zeroProgressStreakRef.current = 0;
            console.warn('[AutoSync] 3-strike silent-failure → forcing session refresh');
            (async () => {
              try {
                const { error } = await supabase.auth.refreshSession();
                if (error) {
                  setState(prev => ({
                    ...prev,
                    syncError: 'Session expired — please sign out and back in to resume sync',
                    syncErrorSeverity: 'fatal',
                  }));
                } else {
                  syncLog.log('[AutoSync] Session refresh succeeded after silent-failure streak');
                }
              } catch (e) {
                setState(prev => ({
                  ...prev,
                  syncError: 'Sync stuck — sign out and back in to resume',
                  syncErrorSeverity: 'fatal',
                }));
              }
            })();
          }
        }

        
        if (!allFetchesFailed) {
          // Refresh unsynced counts (non-blocking)
          updateUnsyncedCounts({ force: true }).catch(() => {});

          // S34: Tally photo changes from this cycle. The photo result is the
          // 4th entry returned by the parallel pipeline above.
          const photoResult = results[3];
          photoChangeCount += Math.max(0, photoResult?.changed || 0);

          // Only broadcast when something photo-related actually moved this cycle.
          if (photoChangeCount > 0) {
            window.dispatchEvent(new CustomEvent('sync-photos-updated'));
          }
          
           // Hybrid cleanup: prune old synced photo blobs (non-blocking)
           pruneOldSyncedPhotoBlobs().catch(() => {});

           // S13: GC photos stuck on temp-* parents > 30 days (non-blocking).
           // Covers temp-parents that never sync (validation/RLS failures) so
           // their blobs don't accumulate forever in IDB.
           // Audit M2: now a static import (file head).
           evictStuckTempPhotos(30).catch(() => {});

           // Storage pressure management (non-blocking)
           // Audit M2: now a static import (file head).
           manageStoragePressure().catch(() => {});

           // S4: Conservative state-aware prune after sync completes.
           // Replaces previous destructive bulk-clear that wiped non-soft-delete entries.
           // Audit M2: `pruneCompletedQueuedOperations` is now a static import (file head).
           (async () => {
             try {
               const pruned = await pruneCompletedQueuedOperations();
               const total = pruned.inspections + pruned.trainings + pruned.assessments;
               if (total > 0) {
                 syncLog.log(`[AutoSync] Post-sync pruned ${total} completed queued operations`, pruned);
               }
             } catch (e) {
               console.warn('[AutoSync] Non-blocking: post-sync queue prune failed:', e);
             }
           })();
          
          // Invalidate queries to refresh UI
          queryClient.invalidateQueries({ queryKey: ['inspections'] });
          queryClient.invalidateQueries({ queryKey: ['trainings'] });
          queryClient.invalidateQueries({ queryKey: ['daily-assessments'] });
          
          // Mobile: Log sync success to console for debugging without toast spam
          if (isMobileDevice) {
            syncLog.log('[AutoSync] Mobile sync complete:', {
              timestamp: new Date().toISOString(),
              itemsSynced: totalSynced,
              remaining: totalRemaining,
              results: results.map(r => ({ success: r?.success || 0, failed: r?.failed || 0, remaining: r?.remaining || 0 })),
            });
          }
          
          // Toast shape depends on whether anything failed in this cycle.
          // F3: photo result has no success/failed counts — inspect remaining/error
          // so a green "synced" toast never fires while photos still pending.
          const photoResultForToast = results[3] as { remaining?: number; error?: string } | null;
          const photosStillPending =
            (photoResultForToast?.remaining ?? 0) > 0 || !!photoResultForToast?.error;

          if (totalFailed > 0 && totalSynced > 0) {
            const msg = `Synced ${totalSynced}; ${totalFailed} failed — will retry`;
            toast.warning(msg);
            addSyncNotification(msg);
          } else if (totalFailed > 0 && totalSynced === 0) {
            const msg = `Sync failed: ${totalFailed} item${totalFailed === 1 ? '' : 's'} could not upload — will retry`;
            toast.error(msg);
            addSyncNotification(msg);
          } else if (cleanSuccess && photosStillPending) {
            const tail = (photoResultForToast?.remaining ?? 0) > 0
              ? `${photoResultForToast!.remaining} photo${photoResultForToast!.remaining === 1 ? '' : 's'} still uploading`
              : 'photos still uploading';
            const msg = `Reports synced (${totalSynced} items); ${tail}`;
            toast.warning(msg);
            addSyncNotification(msg);
          } else if (cleanSuccess) {
            const remainingMsg = totalRemaining > 0 ? ` (${totalRemaining} more queued)` : '';
            toast.success(`Data synced successfully (${totalSynced} items)${remainingMsg}`);
            addSyncNotification(`Data synced successfully (${totalSynced} items)${remainingMsg}`);

            // Reset stale warning flag on successful sync
            staleWarningShownRef.current = false;

            // BUILD_TIMESTAMP audit logging for production diagnostics
            syncLog.log('[AutoSync] Sync confirmed', {
              version: import.meta.env.APP_VERSION,
              build: import.meta.env.BUILD_TIMESTAMP,
              itemsSynced: totalSynced,
              remaining: totalRemaining,
              timestamp: new Date().toISOString(),
            });
          }

          // Only emit sync complete when items were actually synced AND nothing failed.
          // Downstream consumers treat sync-complete as "all clear" — don't mislead them
          // when items remain stuck and need a retry.
          if (cleanSuccess) {
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
              syncLog.warn('[AutoSync] Failed to update backup ledger sync status:', e);
            }
          }
          // iOS: Clear pending sync flags after successful sync (fixes N3 - storage accumulation)
          if (isIOSDevice) {
            clearPendingSyncs();
          }
          
          // S7: Decouple photo drain from report cycle. Photos sync on their own
          // bounded-parallel pipeline inside syncPhotos(); we should NOT re-trigger
          // the heavy report cycle just because photos are still uploading. Compute
          // report-only remaining (results[0..2]) for the accelerated-resync gate.
          const reportResults = results.slice(0, 3);
          const reportRemaining = reportResults.reduce((sum, r) => sum + (r?.remaining || 0), 0);
          const reportFailed = reportResults.reduce((sum, r) => sum + (r?.failed || 0), 0);

          // S7: Feed batch outcome back to atomic-sync-manager so the next cycle's
          // batch size grows on success (drains a 22-report backlog in ~2 cycles).
          noteBatchOutcome(reportFailed);

          if (reportRemaining > 0) {
            // S7: With adaptive batch sizing the queue drains fast. No need for
            // a wall-clock delay on success — schedule the next cycle immediately
            // (still gated by syncInProgressRef + POST_SYNC_COOLDOWN downstream).
            const drainDelay = reportFailed > 0 ? ACCELERATED_SYNC_DELAY : 0;
                          syncLog.log(`[AutoSync] ${reportRemaining} report items remaining - scheduling accelerated sync in ${drainDelay}ms (failed: ${reportFailed})`);
            // Reset the min sync interval guard so the accelerated sync can proceed
            lastSyncAttemptRef.current = Date.now() - MIN_SYNC_INTERVAL + drainDelay;
            setTimeout(() => {
              if (navigator.onLine && !syncInProgressRef.current) {
                performSync(true);
              }
            }, drainDelay);
          } else {
            // S7: Reports are clean. If photos are still draining, schedule a
            // photo-only cycle so we don't wait for the next periodic tick.
            const photoRemaining = results[3]?.remaining || 0;
            if (photoRemaining > 0) {
                              syncLog.log(`[AutoSync] ${photoRemaining} photos remaining - scheduling photo-only drain`);
              lastSyncAttemptRef.current = Date.now() - MIN_SYNC_INTERVAL;
              setTimeout(() => {
                if (navigator.onLine && !syncInProgressRef.current) {
                  performSync(true);
                }
              }, 0);
            }
          }
        } else {
          // All fetches timed out - don't report success, will retry next cycle
          console.warn('[AutoSync] All IndexedDB fetches timed out - not reporting success');
        }
      }
    } catch (error) {
      console.error('[AutoSync] Sync failed:', error);
      logError(error, { scope: 'useAutoSync.performSync' });
      clearTimeout(safetyTimeoutHandle);
      
      // Surface sync failures on every platform. toastError pushes to the
      // notification center AND shows a sonner toast on desktop; on mobile
      // the toast is suppressed and the notification center entry stands in.
      try {
        const { toastError } = await import('@/lib/toast-helpers');
        toastError('Sync failed', error?.message || 'will retry automatically');
      } catch {
        // Chunk-load failure must not break the catch block.
      }
    } finally {
      // S6: Set completed-at BEFORE clearing the in-progress gate so any Realtime
      // event that races past `syncInProgressRef` immediately hits the cooldown gate.
      lastSyncCompletedAtRef.current = Date.now();
      syncInProgressRef.current = false;
      setSyncInProgress(false);
      // CRITICAL: Always reset isSyncing state in finally block to prevent stuck spinner
      setState(prev => ({ ...prev, isSyncing: false }));
      // S21: clear the in-flight ref and resolve awaiters before doing follow-up work
      inFlightSyncRef.current = null;
      resolveInFlight();
      // Always refresh unsynced counts so the badge is accurate after every sync attempt
      updateUnsyncedCounts({ force: true }).catch(() => {});
      // S34: Only broadcast if real photo state changed during this cycle.
      // The post-sync block above also dispatches on the success path; this
      // finally-block fallback covers error/timeout paths where some photo
      // mutations may have completed before the throw.
      if (photoChangeCount > 0) {
        try { window.dispatchEvent(new Event('sync-photos-updated')); } catch {}
      }
      // M3: Tick the cycle counter so the storage RLS probe re-runs every Nth
      // completed cycle. Catches mid-day policy regressions without waiting
      // for the UTC rollover. Internally rate-limited and force-bypasses the
      // daily flag.
      // Audit M2: `maybeRunCycleProbe` is now a static import (file head).
      try {
        maybeRunCycleProbe();
      } catch {
        /* probe failure must never break sync */
      }
      // Sprint 1B: scan for "0,0,null" stuck photos that have been sitting
      // in IDB without ever being attempted. Best-effort, internally
      // debounced per-photoId per-tab + capped at 5 events/session, never
      // throws. Closes the observability gap from audit Finding 2.
      scanForStuckPhotos().catch(() => {
        /* beacon must never break sync */
      });
      // M6: Periodic GC for unresolved quarantined records (>30d).
      // Cycle-throttled + rate-limited inside the helper. Fire-and-forget.
      // Audit M2: `maybeRunQuarantineGc` is now a static import (file head).
      try {
        maybeRunQuarantineGc();
      } catch {
        /* gc failure must never break sync */
      }
    }
  }, [queryClient, isMobileDevice, isIOSDevice]);
  
  /**
   * Update unsynced counts from IndexedDB.
   * S11: When the IDB read fails, preserve the last-known counts and surface
   * a syncError instead of silently zeroing the badge.
   *
   * H1: Coalesced + rate-limited. The underlying readers do `db.getAll()` +
   * JS filter, which is O(N) and runs against iOS's 5s IDB timeout. Hot
   * call sites (post-save, online, visibility, sync-complete, S33 resume)
   * can easily fire 10-20x/min on busy super-admin devices with 500+ rows.
   * Three layers of throttling:
   *   1. In-flight dedup — concurrent callers share the same Promise.
   *   2. Min-gap (1500ms) — back-to-back calls beyond the in-flight window
   *      are debounced into a single trailing read.
   *   3. Fresh-cache short-circuit (5s) — within the freshness window we
   *      return immediately without touching IDB. State is already up to
   *      date from the previous read.
   * Callers that genuinely need a fresh read (e.g. post-sync) can pass
   * `{ force: true }` to bypass the freshness window (still respects the
   * in-flight dedup + min-gap).
   */
  const inFlightCountsRef = useRef<Promise<void> | null>(null);
  const lastCountsRunRef = useRef<number>(0);
  const pendingCountsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const COUNTS_MIN_GAP_MS = 1500;
  const COUNTS_FRESHNESS_MS = 5000;

  const doUpdateUnsyncedCounts = useCallback(async (): Promise<void> => {
    try {
      const user = await getUserWithCache();
      if (!user) return;

      // Audit M2: `isIdbReadFailure` is already a static import at the top of
      // this file — the dynamic re-import here was dead code and removed.
      const [insp, train, assess] = await Promise.all([
        getUnsyncedInspections(user.id),
        getUnsyncedTrainings(user.id),
        getUnsyncedDailyAssessments(user.id),
      ]);

      const anyFailed = isIdbReadFailure(insp) || isIdbReadFailure(train) || isIdbReadFailure(assess);
      if (anyFailed) {
        const failure = [insp, train, assess].find(isIdbReadFailure) as { error: string } | undefined;
        // S40 (Fix C): The counts read failing is independent of the sync
        // pipeline succeeding. Word the message so the user understands the
        // sync itself is fine — this is a stats-refresh hiccup. Avoid surfacing
        // raw error tokens (idb_read_timeout, circuit_breaker_open) — they
        // read as catastrophic and aren't actionable. The Sync Terminal still
        // lights amber via the syncError truthy check, which is correct: the
        // numbers shown may be stale until the next successful read.
        console.warn('[AutoSync] IDB counts read failed — preserving last-known counts', failure?.error);
        // S42 (Fix F): mark severity 'soft' — sync pipeline is fine, this is a stats-read
        // hiccup. The Sync Terminal styles soft errors in amber rather than fatal red.
        setState(prev => ({
          ...prev,
          syncError: 'Stats refresh delayed — pending counts may be out of date',
          syncErrorSeverity: 'soft',
        }));
        return;
      }

      const inspections = insp as DbRow[];
      const trainings = train as DbRow[];
      const assessments = assess as DbRow[];
      const total = inspections.length + trainings.length + assessments.length;

      setState(prev => ({
        ...prev,
        unsyncedCount: total,
        unsyncedInspections: inspections,
        unsyncedTrainings: trainings,
        unsyncedAssessments: assessments,
        syncError: null,
        syncErrorSeverity: null,
      }));

      if (total > 0) {
        syncLog.log('[AutoSync] Unsynced count:', total);
        // Step 1 diagnostics: break down the badge so we can see whether records
        // are stuck on temp- IDs (the most common cause of photo-sync stalls).
        const tempCount = (rows: DbRow[]) =>
          rows.filter(r => typeof (r as { id?: string }).id === 'string' && (r as { id: string }).id.startsWith('temp-')).length;
        const inspTemp = tempCount(inspections);
        const trainTemp = tempCount(trainings);
        const assessTemp = tempCount(assessments);
        console.warn(
          `[AutoSync] Pending breakdown: inspections=${inspections.length} (temp=${inspTemp}) trainings=${trainings.length} (temp=${trainTemp}) daily=${assessments.length} (temp=${assessTemp})`
        );
      }
    } catch (error) {
      console.error('[AutoSync] Error updating unsynced counts:', error);
    }
  }, []);

  const updateUnsyncedCounts = useCallback((opts?: { force?: boolean }): Promise<void> => {
    // 1. Share any in-flight read.
    if (inFlightCountsRef.current) return inFlightCountsRef.current;

    const now = Date.now();
    const sinceLast = now - lastCountsRunRef.current;

    // 3. Fresh-cache short-circuit (skipped when force=true).
    if (!opts?.force && sinceLast < COUNTS_FRESHNESS_MS) {
      return Promise.resolve();
    }

    // 2. Min-gap rate limit. If a trailing-edge timer is already armed,
    // a follow-up tick will pick up the latest state — no new timer needed.
    if (pendingCountsTimerRef.current) {
      return inFlightCountsRef.current ?? Promise.resolve();
    }

    const delay = Math.max(0, COUNTS_MIN_GAP_MS - sinceLast);
    const promise = new Promise<void>((resolve) => {
      pendingCountsTimerRef.current = setTimeout(async () => {
        pendingCountsTimerRef.current = null;
        try {
          await doUpdateUnsyncedCounts();
        } finally {
          lastCountsRunRef.current = Date.now();
          inFlightCountsRef.current = null;
          resolve();
        }
      }, delay);
    });
    inFlightCountsRef.current = promise;
    return promise;
  }, [doUpdateUnsyncedCounts]);
  
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
   * S33: The actual online-reconcile work — refresh session, verify offline auth,
   * trigger sync. Wrapped by `handleOnline` (and `pageshow`) behind a debounce so
   * flaky networks don't stack 5s refreshes.
   */
  const runOnlineReconcile = useCallback(async () => {
    if (!navigator.onLine) {
      // Went offline again before the debounce fired — wait for the next stable online.
              syncLog.log('[AutoSync] Skipping online reconcile — navigator.onLine is false');
      return;
    }

          syncLog.log('[AutoSync] Network reconnected - refreshing session then syncing');

    // Pre-refresh session BEFORE sync to ensure fresh JWT.
    // Keep the 5s race as belt-and-suspenders: even though the outer handler is now
    // debounced, refreshSession() can occasionally hang on a half-open connection.
    try {
      const refreshResult = await Promise.race([
        supabase.auth.refreshSession(),
        new Promise<{ error: { message: string } }>((resolve) =>
          setTimeout(() => resolve({ error: { message: 'Session refresh timeout' } }), 5000)
        ),
      ]);
      if (refreshResult.error) {
        console.warn('[AutoSync] Session refresh failed:', refreshResult.error.message);
      } else         syncLog.log('[AutoSync] Session refreshed successfully');
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

    // C5: After refresh, assert the active session has a real JWT — not the
    // offline placeholder token. If the refresh silently failed and we're still
    // carrying a synthetic session, transmitting that token would 401 every
    // single sync request and dead-letter healthy records.
    try {
      const { looksLikeJwt } = await import('@/lib/synthetic-session-guard');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || !looksLikeJwt(session.access_token)) {
        console.warn('[AutoSync] Skipping sync — session token is not a valid JWT (likely expired refresh token)');
        toast.error('Session expired — please sign in again to sync your work', {
          id: 'sync-session-invalid',
          duration: 8000,
        });
        return;
      }
    } catch (e) {
      console.warn('[AutoSync] Session validation check failed, proceeding cautiously:', e);
    }

    // Use debounced sync to prevent rapid re-syncs on network flicker
    triggerDebouncedSync();
  }, [triggerDebouncedSync]);

  /**
   * Handle online event — debounced so a burst of online/offline flaps coalesces
   * into one refresh+reconcile+sync pass.
   */
  const handleOnline = useCallback(() => {
    if (onlineHandlerTimerRef.current) {
      clearTimeout(onlineHandlerTimerRef.current);
    }
    onlineHandlerTimerRef.current = setTimeout(() => {
      onlineHandlerTimerRef.current = null;
      runOnlineReconcile();
    }, ONLINE_HANDLER_DEBOUNCE);
  }, [runOnlineReconcile]);
  
  /**
   * M3: Reconcile any pending offline-auth synthetic session BEFORE firing
   * a sync. Without this, iOS resume paths (pageshow / focus / visibilitychange)
   * can hit performSync while the session is still the deterministic-UUID
   * placeholder — RLS rejects (data stuck) or, worse, races with a half-completed
   * refreshSession and writes under the wrong inspector_id.
   */
  const reconcileThenSync = useCallback(async (force = true) => {
    if (navigator.onLine && hasPendingOfflineAuth()) {
      try {
        await verifyAndReconcileOfflineAuth();
      } catch (e) {
        console.warn('[AutoSync] Reconcile before resume sync failed:', e);
      }
    }
    performSync(force);
  }, [performSync]);

  /**
   * Handle visibility change - sync when app becomes visible
   */
  const handleVisibilityChange = useCallback(() => {
    if (document.hidden) {
      // H5: tab is backgrounded — abort the in-flight sync so stuck I/O
      // (timeouts, Promise.race wrappers) doesn't keep the tab busy.
      if (activeSyncAbortRef.current && !activeSyncAbortRef.current.signal.aborted) {
                  syncLog.log('[AutoSync] Tab hidden — aborting in-flight sync');
        activeSyncAbortRef.current.abort();
      }
      return;
    }
    if (navigator.onLine) {
              syncLog.log('[AutoSync] App became visible - syncing');
      reconcileThenSync();
    }
  }, [reconcileThenSync]);

  
  /**
   * S12: Debounced full-package refetch (parent + all child collections).
   * Coalesces multiple Realtime events for the same record into one round-trip.
   */
  const scheduleFullRefetch = useCallback((table: string, recordId: string) => {
    const key = `${table}:${recordId}`;
    const existing = refetchTimersRef.current.get(key);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(() => {
      refetchTimersRef.current.delete(key);
      const run = async () => {
        try {
          if (table === 'inspections') {
            await refetchInspectionPackage(recordId);
          } else if (table === 'trainings') {
            await refetchTrainingPackage(recordId);
          } else if (table === 'daily_assessments') {
            await refetchAssessmentPackage(recordId);
          }
          // Notify dashboards / forms that local IDB has fresh data
          window.dispatchEvent(new CustomEvent('dashboard-stale'));
        } catch (e) {
                      syncLog.warn('[AutoSync] Full-package refetch failed:', e);
        }
      };
      run();
    }, REFETCH_DEBOUNCE_MS);
    refetchTimersRef.current.set(key, handle);
  }, []);

  /**
   * Handle Realtime database changes from other devices
   */
  const handleRemoteChange = useCallback((payload: RealtimePostgresChangesPayload<DbRow>) => {
          syncLog.log('[AutoSync] Realtime change detected:', payload.eventType, payload.table);
    
    // Persist the remote record into IndexedDB so offline data stays fresh.
    // Skip if the local copy has unsynced edits (shouldPreserveLocalRecord).
    if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
      const record = payload.new;
      if (record && record.id) {
        const persistToIDB = async () => {
          try {
            // H3: if the form for this record is currently mounted and editing,
            // skip the IDB overwrite. The form holds the truth in React state;
            // an IDB swap here would be silently clobbered by the next debounced
            // autosave and trigger downstream parent/child timestamp mismatches.
            const tableName = payload.table as ActiveFormTable;
            if (
              (tableName === 'inspections' || tableName === 'trainings' || tableName === 'daily_assessments') &&
              isActiveFormRecord(tableName, record.id) &&
              !isRecentSelfWrite(record.id)
            ) {
              emitPendingRemoteUpdate({
                table: tableName,
                recordId: record.id,
                remoteUpdatedAt: record.updated_at || new Date().toISOString(),
              });
                              syncLog.log('[AutoSync] Skipping IDB overwrite — form mounted for', record.id);
              return;
            }
            if (shouldPreserveLocalRecord(record)) return; // don't overwrite richer local data
            // Mode B fix: route through `ingestRemoteRecordOffline`, NOT the
            // user-facing saveXOffline helpers. The latter unconditionally
            // stamp `dirty: true`, which on a cross-device account would put
            // the freshly-server-confirmed record straight back into the
            // unsynced bucket, fire another sync, broadcast another Realtime
            // echo, and loop indefinitely. The ingest helper writes the row
            // with `dirty: false` and `synced_at: record.updated_at` so the
            // next `getUnsynced*` cycle correctly treats it as clean.
            if (
              payload.table === 'inspections' ||
              payload.table === 'trainings' ||
              payload.table === 'daily_assessments'
            ) {
              await ingestRemoteRecordOffline(payload.table, record);
            }
            // F3 backstop: notify the Dashboard so its in-memory list refreshes
            // even if the postgres_changes subscription isn't mounted (e.g. on a
            // route the Dashboard isn't rendering). Cheap; deduped by the
            // Dashboard's lastRefreshTsRef.
            window.dispatchEvent(new CustomEvent('dashboard-stale'));
          } catch (e) {
            // Non-critical — IndexedDB will catch up on next sync cycle
                          syncLog.warn('[AutoSync] Failed to persist Realtime payload to IndexedDB:', e);
          }
        };
        persistToIDB();

        // S12: Debounced full-package refetch — covers cross-device child-row edits
        // (which don't have their own Realtime subscriptions). Skip if this is a
        // self-write echo to avoid redundant round-trips.
        if (!isRecentSelfWrite(record.id)) {
          scheduleFullRefetch(payload.table, record.id);
        }
      }
    }
    
    // Invalidate relevant queries to refresh UI with remote data
    if (payload.table === 'inspections') {
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
    } else if (payload.table === 'trainings') {
      queryClient.invalidateQueries({ queryKey: ['trainings'] });
    } else if (payload.table === 'daily_assessments') {
      queryClient.invalidateQueries({ queryKey: ['daily-assessments'] });
    }
    
    // S6: per-record self-write suppression — if this Realtime event was emitted by
    // our own recent transaction or align_synced_at write, skip the sync re-trigger
    // entirely. IDB persist + query invalidation above still ran (it's a no-op for
    // self-writes since shouldPreserveLocalRecord short-circuits).
    const recordId = (payload?.new as { id?: string } | undefined)?.id || (payload?.old as { id?: string } | undefined)?.id;
    if (recordId && isRecentSelfWrite(recordId)) {
              syncLog.log('[AutoSync] Skipping Realtime-triggered sync (self-write suppression)', { recordId });
      return;
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
                  syncLog.log('[AutoSync] Skipping Realtime-triggered sync (post-sync cooldown)', { msSinceLastComplete });
      } else if (msSinceLastAttempt > MIN_SYNC_INTERVAL) {
        // S10: Call performSync directly — duplicate prevention is handled by syncInProgressRef +
        // POST_SYNC_COOLDOWN + MIN_SYNC_INTERVAL. The 3s debounce just adds lag for multi-device updates.
        performSync(true);
      } else         syncLog.log('[AutoSync] Skipping Realtime-triggered sync (min interval cooldown)', { msSinceLastAttempt });
    } else       syncLog.log('[AutoSync] Skipping Realtime-triggered sync (sync in progress)');
  }, [queryClient, performSync, scheduleFullRefetch]);
  
  // Initialize sync system
  useEffect(() => {
          syncLog.log('[AutoSync] Initializing automatic sync system', {
        isMobile: isMobileDevice,
        isIOS: isIOSDevice,
      });
    
    // PERFORMANCE: Defer initial sync to not block UI render
    // Dashboard data loads from Supabase directly, sync is for reconciliation
    const initialSyncTimer = setTimeout(() => {
      // Rescue Sweep v1: one-time-per-device re-queue of photos that were
      // dead-lettered or long-stuck before the post-fix sync logic shipped.
      // Runs before performSync so re-queued photos are picked up immediately.
      getUserWithCache()
        .then((u) => maybeRunPhotoRescueSweep(u?.id))
        .catch((e) => syncLog.log('[AutoSync] Rescue sweep skipped:', e));

      if (navigator.onLine) {
        performSync(true);
      }
      updateUnsyncedCounts({ force: true });
    }, INITIAL_SYNC_DELAY);
    
    // Event listeners
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // RC-4 / S33 / M3: iOS page restore — reconcile any synthetic offline-auth
    // session FIRST, then sync. bfcache restore is a discrete event (not a flap),
    // so we skip the handleOnline debounce and reconcile inline.
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && navigator.onLine) {
                  syncLog.log('[AutoSync] Page restored from bfcache - reconciling auth then syncing');
        reconcileThenSync();
      }
    };
    
    // RC-2 / M3: Gate iOS focus handler behind MIN_SYNC_INTERVAL debounce,
    // and reconcile any synthetic offline-auth session before syncing.
    const handleFocus = () => {
      if (navigator.onLine) {
        const now = Date.now();
        if (now - lastSyncAttemptRef.current >= MIN_SYNC_INTERVAL) {
          reconcileThenSync();
        } else           syncLog.log('[AutoSync] Focus event debounced (too soon since last sync)');
      }
    };

    if (isIOSDevice) {
      window.addEventListener('pageshow', handlePageShow as EventListener);
      window.addEventListener('focus', handleFocus);
    }
    
    // Adaptive periodic sync. Interval picks the most aggressive applicable rate:
    //   1. Drain Mode active                 → DRAIN_SYNC_INTERVAL_MS (5s, hard)
    //   2. pending>0 + visible + online      → pending-visible boost (10s mobile / 5s desktop)
    //   3. pending>0                         → activeSyncInterval (60s mobile / 30s desktop)
    //   4. idle                              → idleSyncInterval
    const pendingVisibleInterval = isMobileViewport
      ? MOBILE_PENDING_VISIBLE_INTERVAL
      : DESKTOP_PENDING_VISIBLE_INTERVAL;

    const computeInterval = (): number => {
      if (isDrainModeActive()) return DRAIN_SYNC_INTERVAL_MS;
      const pending = unsyncedCountRef.current > 0;
      if (!pending) return idleSyncInterval;
      const visible = typeof document !== 'undefined' && !document.hidden;
      const online = typeof navigator !== 'undefined' && navigator.onLine;
      if (visible && online) return pendingVisibleInterval;
      return activeSyncInterval;
    };

    const scheduleNextSync = () => {
      if (periodicSyncIntervalRef.current) {
        clearInterval(periodicSyncIntervalRef.current);
      }
      const currentInterval = computeInterval();
      periodicSyncIntervalRef.current = setInterval(() => {
        if (!document.hidden && navigator.onLine) {
          performSync(true);
        }
      }, currentInterval);
    };
    scheduleNextSync();

    // Re-schedule when unsynced count changes (adaptive interval)
    const handleSyncPhotosUpdated = () => scheduleNextSync();
    window.addEventListener('sync-photos-updated', handleSyncPhotosUpdated);

    // Drain Mode toggles → re-pick the interval immediately so the user sees
    // the cadence change the instant they tap DRAIN PENDING / STOP.
    const unsubscribeDrainMode = subscribeDrainMode(() => scheduleNextSync());
    // Drain Mode runner: when active, our 5s tick already drives forceSync,
    // but the start() entry point also wants to kick one immediately.
    const unregisterDrainRunner = registerDrainRunner(() => performSync(false));

    // Audit M3: also reschedule when an inspection / training / daily-assessment
    // is saved offline (or otherwise becomes dirty). saveInspectionOffline,
    // saveTrainingOffline, saveDailyAssessmentOffline all dispatch this event.
    // Without it the periodic interval would stay at idleSyncInterval (long)
    // until the next photo upload kicked it down to activeSyncInterval — so
    // a freshly-saved-offline form record could sit in IDB for 60s+ before
    // the next sync attempt.
    //
    // The handler does NOT call scheduleNextSync() — that helper reads the
    // (still-stale) unsyncedCountRef, which `updateUnsyncedCounts` hasn't yet
    // refreshed from the just-completed write. Instead we install
    // activeSyncInterval directly: the event itself is proof that a record was
    // just saved, so we know there is at least one unsynced record. The next
    // tick of `performSync` will recompute the count and `sync-photos-updated`
    // (or another `sync-records-updated`) will swing the interval again.
    const handleSyncRecordsUpdated = () => {
      if (periodicSyncIntervalRef.current) {
        clearInterval(periodicSyncIntervalRef.current);
      }
      periodicSyncIntervalRef.current = setInterval(() => {
        if (!document.hidden && navigator.onLine) {
          performSync(true);
        }
      }, computeInterval());
    };
    window.addEventListener('sync-records-updated', handleSyncRecordsUpdated);

    // H2: When the restore lock releases, kick off a fresh sync so the
    // restored records get pushed to the server promptly (sync was paused
    // while restore was in flight to avoid clobbering the snapshot).
    const unsubscribeRestoreLock = onRestoreLockChange((active) => {
      if (!active) {
        syncLog.log('[AutoSync] Restore lock released - triggering sync');
        // Defer slightly so any trailing IDB writes from restore land first
        setTimeout(() => {
          if (navigator.onLine && !syncInProgressRef.current) {
            performSync(true);
          }
        }, 250);
      }
    });

    // Mode 9F: When the IDB layer-level queue-stuck breaker auto-clears
    // after its cooldown (60s/120s/240s exponential), immediately attempt
    // a drain instead of waiting up to 30s for the next periodic tick.
    // Each cooldown cycle is a probe opportunity against a (hopefully)
    // drained IDB queue; for the offline→online recovery scenario every
    // probe attempt counts (the e2e spec budget is 120s — a missed
    // 30-second tick is a missed pass). The breaker itself bounds the
    // call rate (next trip raises cooldown), so this cannot busy-loop.
    const unsubscribeLayerBreakerClose = subscribeToLayerBreakerClose(() => {
      if (!navigator.onLine) return;
      syncLog.log('[AutoSync] IDB layer breaker cleared — triggering immediate drain attempt');
      // Defer one tick so the breaker's transition completes before any
      // performSync-driven boundary call re-checks state.
      setTimeout(() => {
        if (navigator.onLine && !syncInProgressRef.current) {
          performSync(true);
        }
      }, 0);
    });
    
    {
      const currentInterval = unsyncedCountRef.current > 0 ? activeSyncInterval : idleSyncInterval;
      syncLog.log('[AutoSync] Initialized with interval:', currentInterval / 1000, 's (mobile viewport:', isMobileViewport, ', idle:', unsyncedCountRef.current === 0, ')');
    }
    
    // Realtime subscriptions for multi-device sync — extracted for auto-recovery
    const setupRealtimeChannel = () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      
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
                      syncLog.log('[AutoSync] Realtime subscription status:', status);
          if (status === 'CHANNEL_ERROR') {
            realtimeErrorCountRef.current++;
            if (realtimeErrorCountRef.current >= 3 && channelRef.current) {
              const backoff = realtimeBackoffRef.current;
              console.warn(`[AutoSync] 3+ consecutive CHANNEL_ERRORs — unsubscribing. Auto-reconnect in ${backoff / 1000}s.`);
              supabase.removeChannel(channelRef.current);
              channelRef.current = null;
              realtimeErrorCountRef.current = 0;
              
              // Schedule auto-reconnect with exponential backoff
              if (realtimeReconnectTimerRef.current) {
                clearTimeout(realtimeReconnectTimerRef.current);
              }
              realtimeReconnectTimerRef.current = setTimeout(() => {
                syncLog.log('[AutoSync] Attempting Realtime channel reconnect...');
                setupRealtimeChannel();
              }, backoff);
              
              // Double backoff for next trip, cap at 5 minutes
              realtimeBackoffRef.current = Math.min(backoff * 2, 300000);
            }
          } else if (status === 'SUBSCRIBED') {
            realtimeErrorCountRef.current = 0;
            realtimeBackoffRef.current = 60000;
            if (realtimeReconnectTimerRef.current) {
              clearTimeout(realtimeReconnectTimerRef.current);
              realtimeReconnectTimerRef.current = null;
            }
          }
        });
    };
    
    setupRealtimeChannel();

    // H1: iOS Safari kills suspended websockets silently when a backgrounded
    // tab is re-foregrounded after bfcache restore, tab switch, or network
    // handoff (Wi-Fi ↔ cellular on iPad). supabase-js does not fire
    // CHANNEL_ERROR for a websocket that died during suspension, so the
    // existing 3× CHANNEL_ERROR backoff above never trips and the channel
    // sits in a dead state — the user silently misses cross-device updates
    // (admin edits, co-worker inspections) until they reload the page. We
    // recover by tearing down + recreating the channel on app-resume
    // signals, throttled to once per 30s so quick tab-flips don't thrash.
    const REALTIME_RESUBSCRIBE_THROTTLE_MS = 30_000;
    const resubscribeRealtimeIfStale = (reason: string) => {
      const now = Date.now();
      if (now - lastRealtimeResubscribeAtRef.current < REALTIME_RESUBSCRIBE_THROTTLE_MS) {
        syncLog.log(`[AutoSync] Realtime resubscribe throttled (${reason})`);
        return;
      }
      lastRealtimeResubscribeAtRef.current = now;
      // Cancel any pending CHANNEL_ERROR-backoff reconnect; otherwise that
      // timer would fire and call `setupRealtimeChannel()` again moments after
      // we re-subscribe, tearing down the fresh channel mid-handshake and
      // briefly dropping events. Also reset the error counter + backoff so a
      // single transient CHANNEL_ERROR on the freshly-subscribed channel
      // doesn't immediately re-arm the 3× backoff using stale counts from the
      // dead pre-resume channel.
      if (realtimeReconnectTimerRef.current) {
        clearTimeout(realtimeReconnectTimerRef.current);
        realtimeReconnectTimerRef.current = null;
      }
      realtimeErrorCountRef.current = 0;
      realtimeBackoffRef.current = 60000;
      syncLog.log(`[AutoSync] Resubscribing Realtime channel — ${reason}`);
      setupRealtimeChannel();
    };
    const handleRealtimeOnline = () => resubscribeRealtimeIfStale('online');
    const handleRealtimeVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        resubscribeRealtimeIfStale('visibilitychange');
      }
    };
    // `pageshow` fires with `persisted: false` on initial page load too — only
    // the bfcache-restore case needs a resubscribe (the initial-load channel
    // was just created above by `setupRealtimeChannel()`). Without this guard,
    // the throttle ref starts at 0 so the throttle check passes and the fresh
    // channel is torn down mid-handshake every iOS page load.
    const handleRealtimePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) resubscribeRealtimeIfStale('pageshow');
    };
    const handleRealtimeFocus = () => resubscribeRealtimeIfStale('focus');
    window.addEventListener('online', handleRealtimeOnline);
    document.addEventListener('visibilitychange', handleRealtimeVisibilityChange);
    if (isIOSDevice) {
      window.addEventListener('pageshow', handleRealtimePageShow);
      window.addEventListener('focus', handleRealtimeFocus);
    }

    return () => {
      clearTimeout(initialSyncTimer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('sync-photos-updated', handleSyncPhotosUpdated);
      window.removeEventListener('sync-records-updated', handleSyncRecordsUpdated);
      unsubscribeRestoreLock();
      unsubscribeLayerBreakerClose();
      unsubscribeDrainMode();
      unregisterDrainRunner();
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      // H1: tear down resume-triggered Realtime resubscribers
      window.removeEventListener('online', handleRealtimeOnline);
      document.removeEventListener('visibilitychange', handleRealtimeVisibilityChange);
      if (isIOSDevice) {
        window.removeEventListener('pageshow', handleRealtimePageShow);
        window.removeEventListener('focus', handleRealtimeFocus);
      }

      if (isIOSDevice) {
        window.removeEventListener('pageshow', handlePageShow as EventListener);
        window.removeEventListener('focus', handleFocus);
      }
      
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      if (onlineHandlerTimerRef.current) {
        clearTimeout(onlineHandlerTimerRef.current);
      }
      
      if (periodicSyncIntervalRef.current) {
        clearInterval(periodicSyncIntervalRef.current);
      }
      
      if (realtimeReconnectTimerRef.current) {
        clearTimeout(realtimeReconnectTimerRef.current);
      }
      
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }

      // S12: clear any pending package refetches
      refetchTimersRef.current.forEach((handle) => clearTimeout(handle));
      refetchTimersRef.current.clear();
    };
  }, [performSync, handleOnline, handleVisibilityChange, handleRemoteChange, updateUnsyncedCounts, isIOSDevice, isMobileDevice, activeSyncInterval, idleSyncInterval, isMobileViewport]);
  
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
