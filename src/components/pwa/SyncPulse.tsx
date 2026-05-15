import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePWA } from '@/hooks/usePWA';
import { isIOS } from '@/lib/mobile-detection';
import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  getDeadLetterPhotos,
  resetPhotoRetryCounts,
  resetLayerBreakerOnUserActivity,
  forceCloseAndReopenDB,
  forceDeleteLocalRecord,
} from '@/lib/offline-storage';
import {
  runSyncDiagnostic,
  formatSyncDiagnostic,
  type SyncDiagnosticReport,
} from '@/lib/sync-diagnostic-probe';
import { useUnsyncedPhotos } from '@/hooks/useUnsyncedPhotos';
import {
  getPhotoRetryBuckets,
  type PhotoRetryBuckets,
} from '@/lib/photo-retry-buckets';
import {
  getValidationStuckRecords,
  type ValidationBuckets,
} from '@/lib/validation-buckets';
import { getQuarantineSnapshot, clearAllQuarantines } from '@/lib/sync-quarantine';
import {
  collectSyncDiagnostics,
  reassignOrphanToCurrentUser,
  deleteOrphanLocally,
  type SyncDiagnosticsReport,
} from '@/lib/sync-diagnostics';
import {
  getSyncHaltState,
  subscribeSyncHalt,
  type SyncHaltState,
} from '@/lib/sync-halt-tracker';
import { supabase } from '@/integrations/supabase/client';
import { getUserWithCache } from '@/lib/cached-auth';
import {
  startDrainMode,
  stopDrainMode,
  subscribeDrainMode,
  isDrainModeActive,
} from '@/lib/drain-mode';
import { isWakeLockSupported } from '@/lib/wake-lock';
import { hardResetDatabase } from '@/lib/hard-reset-database';
import { runStorageSourceDiagnostic } from '@/lib/storage-source-diagnostic';

type Phase = 'idle' | 'syncing' | 'synced' | 'unsynced' | 'paused' | 'error';

/**
 * Sprint 1D: short human-readable delta for the RETRYING bucket header.
 * `_tick` is unused but accepted so React re-renders the row each second
 * via the 1Hz interval the parent component starts.
 */
function formatRetryCountdown(nextRetryAt: number, _tick: number): string {
  const now = Date.now();
  const remainingMs = nextRetryAt - now;
  if (remainingMs <= 0) return 'now';
  const seconds = Math.ceil(remainingMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes}m`;
}

/**
 * SyncPulse — minimal dot-based sync indicator.
 * Tappable to open a retro-tech terminal detail sheet with sync status info.
 */
export const SyncPulse = ({ className }: { className?: string }) => {
  const {
    unsyncedCount,
    unsyncedInspections,
    unsyncedTrainings,
    unsyncedAssessments,
    isSyncing,
    lastSyncTime,
    syncError,
    syncErrorSeverity,
    isOnline,
    unsyncedPhotoCount,
    deadLetterCount,
    forceSync,
    refreshSyncStateFromStorage,
    updatePhotoCount,
  } = usePWA();
  const { regressionSkipCount } = useUnsyncedPhotos();

  const navigate = useNavigate();
  const isIOSDevice = isIOS();
  const [justSynced, setJustSynced] = useState(false);
  const [previousSyncingState, setPreviousSyncingState] = useState(false);
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoverResult, setRecoverResult] = useState<null | { ok: boolean; message: string }>(null);
  const [multiTabBlock, setMultiTabBlock] = useState(false);
  const [quarantinedCount, setQuarantinedCount] = useState(0);
  const [diag, setDiag] = useState<SyncDiagnosticsReport>({ orphanRecords: [], tempParentPhotos: [], partial: false });
  const [haltState, setHaltState] = useState<SyncHaltState | null>(() => getSyncHaltState());
  // Tick once a second while a halt with `autoResumeAt` is active so the
  // countdown rendered in the terminal sheet stays accurate.
  const [, setHaltTick] = useState(0);
  const [busyOrphanId, setBusyOrphanId] = useState<string | null>(null);
  const [selfCheckRunning, setSelfCheckRunning] = useState(false);
  const [selfCheckResult, setSelfCheckResult] = useState<null | {
    ok: boolean;
    label: string;
    detail?: string;
  }>(null);
  // Sprint 2 I: one-shot "Why is my sync stuck?" diagnostic. Captured
  // verbatim into the sheet so the user can copy it back to support
  // instead of taking a screenshot.
  const [diagnosticRunning, setDiagnosticRunning] = useState(false);
  const [diagnosticReport, setDiagnosticReport] = useState<SyncDiagnosticReport | null>(null);
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);
  const [hardResetting, setHardResetting] = useState(false);
  // TEMPORARY storage-source diagnostic — surfaces where each "phantom"
  // pending report is actually stored (IDB / rw_backup_ ledger /
  // quarantine sessionStorage / validation-stuck / stale React state).
  // Read-only; no mutations.
  const [storageDiagRunning, setStorageDiagRunning] = useState(false);
  const [storageDiagReport, setStorageDiagReport] = useState<string | null>(null);
  const [storageDiagCopied, setStorageDiagCopied] = useState(false);
  // Collapsible disclosure state for the SELF-CHECK and DIAGNOSTIC panels.
  // The ▸/▾ caret in the header doubles as a tap-target that toggles each
  // panel — on small screens the action button was getting clipped off
  // the right edge so users couldn't tell the section was interactive.
  const [selfCheckExpanded, setSelfCheckExpanded] = useState(false);
  const [diagnosticExpanded, setDiagnosticExpanded] = useState(false);
  // Per-category disclosure state for the Sync Terminal sheet. Actionable
  // problem categories default-open so the user immediately sees what's
  // blocking sync; informational ones default-closed.
  const [pendingReportsExpanded, setPendingReportsExpanded] = useState(true);
  const [pendingPhotosExpanded, setPendingPhotosExpanded] = useState(true);
  const [stuckValidationExpanded, setStuckValidationExpanded] = useState(true);
  const [heldBackExpanded, setHeldBackExpanded] = useState(false);
  const [quarantinedExpanded, setQuarantinedExpanded] = useState(true);
  const [failedPhotosExpanded, setFailedPhotosExpanded] = useState(true);
  const [orphanRecordsExpanded, setOrphanRecordsExpanded] = useState(true);
  // Drain Mode (foreground "push everything now"). Also tracks whether the
  // wake-lock acquired so we can surface a fallback hint on iOS < 16.4 where
  // the OS will still auto-lock the screen and suspend the tab.
  const [drainActive, setDrainActive] = useState<boolean>(() => isDrainModeActive());
  const [drainStarting, setDrainStarting] = useState(false);
  const [drainWakeLockHeld, setDrainWakeLockHeld] = useState(true);
  useEffect(() => subscribeDrainMode(setDrainActive), []);
  // Auto-stop drain mode the moment the queue hits zero. The 10-min safety
  // cap in drain-mode.ts is a backstop; this is the happy path.
  useEffect(() => {
    if (drainActive && unsyncedCount === 0 && unsyncedPhotoCount === 0) {
      void stopDrainMode('complete');
    }
  }, [drainActive, unsyncedCount, unsyncedPhotoCount]);
  // Sprint 1D: per-photo retry-state breakdown (READY/RETRYING/STUCK)
  // — see src/lib/photo-retry-buckets.ts. Refreshed on every
  // `sync-photos-updated` event and on a 1Hz tick while the sheet is
  // open so the RETRYING countdown stays live.
  const [photoBuckets, setPhotoBuckets] = useState<PhotoRetryBuckets>({
    ready: 0,
    retrying: 0,
    stuck: 0,
    blocked: 0,
    retryingMinNextRetryAt: null,
    stuckIds: [],
    blockedParentIds: [],
  });
  const [retryingTick, setRetryingTick] = useState(0);
  // PR #2 (Sync Terminal STUCK-validation bucket): parent records that
  // would currently fail client-side validation at sync time. Surfaces
  // the records PR #178's form-side gate now prevents going forward,
  // but that were already stranded on the device before #178 shipped.
  const [validationStuck, setValidationStuck] = useState<ValidationBuckets>({
    count: 0,
    records: [],
  });

  const runSelfCheck = useCallback(async () => {
    setSelfCheckRunning(true);
    setSelfCheckResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('sync-self-check', {
        headers: { 'x-client-now': String(Date.now()) },
      });
      if (error) {
        setSelfCheckResult({
          ok: false,
          label: 'JWT_FAIL',
          detail: error.message ?? 'Function invocation failed',
        });
        return;
      }
      const r = data as {
        jwt_ok?: boolean;
        rls_ok?: boolean;
        probes?: Array<{ table: string; ok: boolean; error?: string }>;
        clock_skew_ms?: number | null;
      };
      if (!r?.jwt_ok) {
        setSelfCheckResult({ ok: false, label: 'JWT_FAIL', detail: 'Session token rejected. Sign out and back in.' });
        return;
      }
      if (!r.rls_ok) {
        const failed = (r.probes ?? []).filter((p) => !p.ok).map((p) => p.table).join(', ');
        setSelfCheckResult({ ok: false, label: 'RLS_FAIL', detail: `Blocked: ${failed || 'unknown'}` });
        return;
      }
      const skew = r.clock_skew_ms ?? 0;
      const skewWarn = Math.abs(skew) > 60_000;
      setSelfCheckResult({
        ok: !skewWarn,
        label: skewWarn ? 'CLOCK_SKEW' : 'OK',
        detail: skewWarn ? `Device clock off by ${Math.round(skew / 1000)}s` : 'Auth + visibility healthy',
      });
    } catch (e) {
      setSelfCheckResult({ ok: false, label: 'NET_FAIL', detail: (e as Error).message });
    } finally {
      setSelfCheckRunning(false);
    }
  }, []);

  const refreshDiagnostics = useCallback(async () => {
    try {
      const r = await collectSyncDiagnostics();
      setDiag(r);
    } catch (e) {
      console.warn('[SyncPulse] diagnostics failed:', e);
    }
  }, []);

  useEffect(() => {
    if (open) refreshDiagnostics();
  }, [open, lastSyncTime, refreshDiagnostics]);

  // Sprint 1D: subscribe to sync-photos-updated for fresh bucket counts.
  // Also refresh when the sheet opens so the user always sees current state.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await getPhotoRetryBuckets();
        if (!cancelled) setPhotoBuckets(next);
      } catch {
        /* boundary returns EMPTY internally; nothing to do here */
      }
    };
    refresh();
    const handler = () => {
      void refresh();
    };
    window.addEventListener('sync-photos-updated', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('sync-photos-updated', handler);
    };
  }, [open]);

  // PR #2 (validation-stuck bucket): re-run the parent validator on
  // every unsynced parent record so stranded records (organization
  // cleared on-device etc.) get surfaced with a deep-link to recover.
  // Refresh when the sheet opens and after every sync attempt so
  // records leave the bucket as soon as they sync successfully.
  //
  // Always scope by current user id (resolved through `getUserWithCache`
  // — the same cached-auth helper `useAutoSync` uses) so shared-device
  // accounts don't see each other's stranded records and the FIX
  // deep-link can never navigate into another user's form.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const user = await getUserWithCache();
        if (cancelled) return;
        if (!user?.id) {
          setValidationStuck({ count: 0, records: [] });
          return;
        }
        const next = await getValidationStuckRecords(user.id);
        if (!cancelled) setValidationStuck(next);
      } catch {
        /* boundary returns EMPTY internally; nothing to do here */
      }
    };
    refresh();
    return () => {
      cancelled = true;
    };
  }, [open, lastSyncTime]);

  // Sprint 1D: 1Hz tick while a RETRYING countdown is active so the
  // displayed delta stays live without re-fetching IDB every second.
  useEffect(() => {
    if (!photoBuckets.retryingMinNextRetryAt) return;
    const id = window.setInterval(() => setRetryingTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [photoBuckets.retryingMinNextRetryAt]);

  // S41 (Fix E + option i): surface session-quarantined records the sync pipeline has
  // given up on this session. Refresh when sheet opens or sync state changes.
  useEffect(() => {
    const snap = getQuarantineSnapshot();
    const now = Date.now();
    const active = Object.values(snap).filter(
      (e) => e.quarantinedUntil !== null && now < (e.quarantinedUntil as number),
    ).length;
    setQuarantinedCount(active);
  }, [open, isSyncing, lastSyncTime]);

  // Subscribe to sync-halt-tracker so the badge can flip to PAUSED the moment
  // a silent-return path fires inside `performSync`.
  useEffect(() => {
    const unsub = subscribeSyncHalt((s) => setHaltState(s));
    return unsub;
  }, []);

  // Multi-tab block listener — `getDB()` dispatches `sync-multi-tab-block`
  // when an upgrade is blocked >3s by another tab/SW holding the connection.
  // Auto-clears 30s after the last fire so the banner doesn't get stuck on.
  useEffect(() => {
    let clearT: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      setMultiTabBlock(true);
      if (clearT) clearTimeout(clearT);
      clearT = setTimeout(() => setMultiTabBlock(false), 30_000);
    };
    window.addEventListener('sync-multi-tab-block', handler as EventListener);
    return () => {
      window.removeEventListener('sync-multi-tab-block', handler as EventListener);
      if (clearT) clearTimeout(clearT);
    };
  }, []);

  // 1Hz tick while a countdown halt is active, so the rendered "Auto-resumes
  // in Ns" text stays current. Stops when no countdown is outstanding.
  useEffect(() => {
    if (!haltState?.autoResumeAt) return;
    const t = setInterval(() => setHaltTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [haltState?.autoResumeAt]);

  // Sprint 1D fix-forward (PR #167): photo count must include photos in
  // jittered backoff, otherwise the dot/badge can read "ALL SYNCED" while the
  // terminal still shows RETRYING rows. Math.max is a belt-and-suspenders
  // fallback covering the brief window between mount and the first
  // getPhotoRetryBuckets() resolve, where photoBuckets is still all-zeros but
  // useUnsyncedPhotos may already report a count.
  const photoBucketTotal =
    photoBuckets.ready + photoBuckets.retrying + photoBuckets.stuck + photoBuckets.blocked;
  const photoCountForIndicator = Math.max(unsyncedPhotoCount, photoBucketTotal);
  const totalUnsynced = unsyncedCount + photoCountForIndicator;

  // Detect sync completion → show green for 2s then fade
  useEffect(() => {
    if (previousSyncingState && !isSyncing && !syncError) {
      setJustSynced(true);
      const timer = setTimeout(() => setJustSynced(false), 2000);
      return () => clearTimeout(timer);
    }
    setPreviousSyncingState(isSyncing);
  }, [isSyncing, syncError, previousSyncingState]);

  // Derive phase
  // S42 (Fix F): only fatal-severity errors flip the indicator to red SYNC FAILED.
  // Soft errors (stats/photo-counts hiccups) keep the underlying phase and surface
  // an amber advisory line in the terminal instead.
  const isFatalError = syncError !== null && syncErrorSeverity === 'fatal';
  // A halt is only meaningful while the engine isn't actively running and we
  // have something pending. Otherwise (e.g. the paused state was leftover but
  // the next tick already drained the queue) we let the normal phase win.
  const showPaused =
    !isSyncing &&
    !isFatalError &&
    haltState !== null &&
    totalUnsynced > 0 &&
    isOnline;
  let phase: Phase = 'idle';
  if (!isOnline) phase = 'error';
  else if (isFatalError) phase = 'error';
  else if (isSyncing) phase = 'syncing';
  else if (justSynced) phase = 'synced';
  else if (showPaused) phase = 'paused';
  else if (totalUnsynced > 0) phase = 'unsynced';

  const formatLastSync = (date: Date | null) => {
    if (!date) return 'Never';
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const statusLabel =
    phase === 'syncing' ? 'SYNCING...'
    : phase === 'error' ? (isOnline ? 'SYNC FAILED' : 'OFFLINE')
    : phase === 'paused' ? `PAUSED · ${haltState?.label ?? '—'}`
    : phase === 'unsynced' ? `${totalUnsynced} PENDING`
    : phase === 'synced' ? 'SYNCED'
    : 'ALL SYNCED';

  // Plain-English countdown for the terminal sheet, refreshed by the 1Hz tick.
  const haltCountdown = (() => {
    if (!haltState?.autoResumeAt) return null;
    const remainingMs = haltState.autoResumeAt - Date.now();
    if (remainingMs <= 0) return 'Resuming …';
    const sec = Math.ceil(remainingMs / 1000);
    if (sec < 60) return `Auto-resumes in ${sec}s`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return rem === 0
      ? `Auto-resumes in ${min}m`
      : `Auto-resumes in ${min}m ${rem}s`;
  })();

  return (
    <>
      <button
        type="button"
        aria-label="Sync status"
        onClick={() => {
          // Sprint 2 H: opening the sync terminal is direct evidence the
          // device isn't OS-wedged. Auto-clear the layer breaker so any
          // queued sync probe runs immediately rather than making the
          // user wait out a 1-4 minute cooldown.
          resetLayerBreakerOnUserActivity('SyncPulse opened');
          setOpen(true);
        }}
        className={cn('relative flex items-center justify-center w-8 h-8', className)}
      >
        <div
          className={cn(
            'w-2 h-2 rounded-full transition-all duration-500 ease-in-out',
            phase === 'syncing' && 'bg-blue-500 opacity-90 animate-[pulse_2s_ease-in-out_infinite]',
            phase === 'error' && 'bg-destructive opacity-100',
            phase === 'paused' && 'bg-yellow-500 opacity-90 animate-[pulse_2.5s_ease-in-out_infinite]',
            phase === 'unsynced' && 'bg-amber-500 opacity-80',
            phase === 'synced' && 'bg-green-500 opacity-100',
            phase === 'idle' && 'opacity-0',
          )}
        />
        {totalUnsynced > 0 && phase !== 'syncing' && (
          <span className="absolute -top-0.5 -right-0.5 text-[9px] font-mono leading-none bg-amber-500 text-white rounded-full min-w-[14px] h-[14px] flex items-center justify-center">
            {totalUnsynced}
          </span>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-xl max-h-[70vh] overflow-y-auto bg-[hsl(160,20%,6%)] border-t border-green-900/50 p-0">
          <SheetHeader className="px-4 pt-4 pb-2">
            <SheetTitle className="text-sm font-mono uppercase tracking-widest text-green-400">
              ▸ Sync Terminal
            </SheetTitle>
            <SheetDescription className="sr-only">Details about data synchronization</SheetDescription>
          </SheetHeader>

          <div className="crt-scanlines space-y-3 text-xs font-mono px-4 pb-5">
            {/* Drain Pending — user-initiated foreground burst sync. Only
                offered when there's actually something to push and we're
                online. While active, useAutoSync polls every 5s and a
                screen wake-lock keeps the iPad/iPhone tab alive past
                auto-lock. Auto-stops when the queue hits 0 or after the
                10-min safety cap in drain-mode.ts. */}
            {totalUnsynced > 0 && isOnline && (
              <div className={cn(
                'rounded border p-2.5 space-y-1.5',
                drainActive
                  ? 'border-blue-700/60 bg-blue-950/40'
                  : 'border-amber-700/60 bg-amber-950/30',
              )}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-amber-300">
                      {drainActive ? 'DRAINING…' : 'DRAIN PENDING'}
                    </span>
                    <span className="text-[10px] text-green-300/70">
                      {drainActive
                        ? `${totalUnsynced} item${totalUnsynced === 1 ? '' : 's'} remaining`
                        : `${totalUnsynced} item${totalUnsynced === 1 ? '' : 's'} waiting — push now`}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={drainStarting}
                    onClick={async () => {
                      if (drainActive) {
                        await stopDrainMode('user');
                        // Drain may have synced everything — refresh
                        // counts from IDB so the list reflects reality
                        // instead of the pre-drain React snapshot.
                        await refreshSyncStateFromStorage();
                        return;
                      }
                      setDrainStarting(true);
                      try {
                        const { wakeLockHeld } = await startDrainMode();
                        setDrainWakeLockHeld(wakeLockHeld);
                      } finally {
                        setDrainStarting(false);
                      }
                    }}
                    className={cn(
                      'text-[10px] uppercase tracking-wider px-3 py-1.5 rounded border min-h-[36px] min-w-[88px] disabled:opacity-50',
                      drainActive
                        ? 'border-red-700/70 text-red-300 hover:bg-red-900/30'
                        : 'border-amber-600/70 text-amber-200 hover:bg-amber-900/40',
                    )}
                  >
                    {drainStarting ? 'STARTING…' : drainActive ? 'STOP' : 'DRAIN NOW'}
                  </button>
                </div>
                {drainActive && !drainWakeLockHeld && (
                  <p className="text-[10px] text-amber-200/80 leading-relaxed">
                    Keep this screen on — your device doesn't support automatic
                    wake-lock. Disable Auto-Lock in Settings while draining.
                  </p>
                )}
                {!drainActive && isWakeLockSupported() && (
                  <p className="text-[10px] text-green-300/60 leading-relaxed">
                    Holds the screen awake and pushes every 5 seconds until the queue is empty.
                  </p>
                )}
              </div>
            )}

            {/* Status row */}
            <div className="flex items-center justify-between text-green-300/80">
              <span>STATUS</span>
              <span className={cn(
                'font-bold px-2 py-0.5 rounded text-[10px] uppercase tracking-wider',
                phase === 'syncing' && 'bg-blue-900/50 text-blue-300',
                phase === 'error' && 'bg-red-900/50 text-red-300',
                phase === 'paused' && 'bg-yellow-900/50 text-yellow-300',
                phase === 'unsynced' && 'bg-amber-900/50 text-amber-300',
                phase === 'synced' && 'bg-green-900/50 text-green-300',
                phase === 'idle' && 'bg-green-900/50 text-green-300',
              )}>
                {statusLabel}
                {phase === 'syncing' && <span className="inline-block w-1.5 h-3 ml-1 bg-blue-300 animate-[blink-cursor_1s_step-end_infinite]" />}
              </span>
            </div>

            {/* Last sync */}
            <div className="flex items-center justify-between text-green-300/80">
              <span>LAST_SYNC</span>
              <span className="text-green-400">{formatLastSync(lastSyncTime)}</span>
            </div>

            {/* Last aligned */}
            <div className="flex items-center justify-between text-green-300/80">
              <span>LAST_ALIGNED</span>
              <span className="text-green-400">
                {lastSyncTime ? formatLastSync(lastSyncTime) : '—'}
                {isSyncing && <span className="inline-block w-1.5 h-3 ml-1 bg-green-400 animate-[blink-cursor_1s_step-end_infinite]" />}
              </span>
            </div>

            {/* Sync engine paused — surfaces a silent-halt reason from
                useAutoSync's performSync so a stuck PENDING badge has a
                user-visible explanation instead of feeling broken. */}
            {showPaused && haltState && (
              <div className="space-y-1.5 border-t border-green-900/40 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-yellow-400 text-[10px] uppercase tracking-wider">
                    ▸ Sync engine paused
                  </span>
                  <button
                    type="button"
                    disabled={retrying}
                    onClick={async () => {
                      try {
                        setRetrying(true);
                        resetLayerBreakerOnUserActivity('SyncPulse retry'); await forceSync();
                      } catch (e) {
                        console.warn('[SyncPulse] Force sync after halt failed:', e);
                      } finally {
                        setRetrying(false);
                      }
                    }}
                    className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-yellow-700/60 text-yellow-300 hover:bg-yellow-900/30 disabled:opacity-50"
                  >
                    {retrying ? 'RETRYING…' : 'RETRY NOW'}
                  </button>
                </div>
                <p className="text-yellow-200/90 text-[10px] leading-relaxed">
                  {haltState.detail}
                </p>
                {haltCountdown && (
                  <p className="text-yellow-300/70 text-[10px] italic">
                    {haltCountdown}
                  </p>
                )}

                {/* Last-resort recovery: when the layer breaker is open or
                    a multi-tab block was detected, the local IDB handle is
                    likely wedged. RETRY NOW just re-runs forceSync, which
                    re-enters the same wedge. RECOVER STORAGE forcibly
                    closes the cached handle, asks the SW to release its
                    handle, resets all breakers, and re-opens. */}
                {(haltState.code === 'circuit_breaker_open' || multiTabBlock) && (
                  <div className="mt-2 pt-2 border-t border-yellow-900/40 space-y-1.5">
                    <button
                      type="button"
                      disabled={recovering}
                      onClick={async () => {
                        setRecoverResult(null);
                        setRecovering(true);
                        try {
                          const ok = await forceCloseAndReopenDB();
                          if (ok) {
                            try { clearAllQuarantines(); } catch { /* ignore */ }
                            try { resetLayerBreakerOnUserActivity('SyncPulse recover'); } catch { /* ignore */ }
                            try { await forceSync(); } catch { /* ignore */ }
                            setRecoverResult({ ok: true, message: 'STORAGE RECOVERED — sync resumed.' });
                            setMultiTabBlock(false);
                          } else {
                            setRecoverResult({
                              ok: false,
                              message: 'STILL WEDGED — close any other browser tabs of this app, then tap RECOVER again.',
                            });
                          }
                        } catch (e) {
                          console.warn('[SyncPulse] forceCloseAndReopenDB failed:', e);
                          setRecoverResult({
                            ok: false,
                            message: 'RECOVERY FAILED — close all other tabs of this app and refresh the page.',
                          });
                        } finally {
                          setRecovering(false);
                        }
                      }}
                      className="w-full text-[10px] uppercase tracking-wider px-2 py-1.5 rounded border border-red-600/70 text-red-300 hover:bg-red-900/30 disabled:opacity-50 min-h-[36px]"
                    >
                      {recovering ? 'RECOVERING…' : 'RECOVER STORAGE'}
                    </button>
                    {multiTabBlock && (
                      <p className="text-amber-300/90 text-[10px] leading-relaxed">
                        Another tab of this app is blocking sync. Close other tabs of RopeWorks, then tap RECOVER STORAGE.
                      </p>
                    )}
                    {recoverResult && (
                      <p className={cn(
                        'text-[10px] leading-relaxed',
                        recoverResult.ok ? 'text-green-300' : 'text-red-300',
                      )}>
                        {recoverResult.message}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Pending reports */}
            {unsyncedCount > 0 && (
              <div className="space-y-1.5 border-t border-green-900/40 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingReportsExpanded(v => !v)}
                  aria-expanded={pendingReportsExpanded}
                  style={{ touchAction: 'manipulation' }}
                  className="w-full min-h-[44px] flex items-center justify-between text-left text-green-400 text-[10px] uppercase tracking-wider hover:text-green-300 active:text-green-300 py-2 -my-1"
                >
                  <span>{pendingReportsExpanded ? '▾' : '▸'} Pending reports ({unsyncedCount})</span>
                  <span className="text-green-700 text-[9px]">{pendingReportsExpanded ? 'TAP TO HIDE' : 'TAP TO OPEN'}</span>
                </button>
                {pendingReportsExpanded && (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {unsyncedInspections.map((item) => (
                      <PendingReportRow
                        key={item.id}
                        kind="INS"
                        accent="blue"
                        label={item.organization || 'Untitled'}
                        sublabel={item.location ? `@ ${item.location}` : undefined}
                        onDrop={async () => {
                          await forceDeleteLocalRecord('inspections', item.id);
                          try { await forceSync(); } catch { /* breaker open is fine */ }
                        }}
                      />
                    ))}
                    {unsyncedTrainings.map((item) => (
                      <PendingReportRow
                        key={item.id}
                        kind="TRN"
                        accent="purple"
                        label={item.organization || 'Untitled'}
                        onDrop={async () => {
                          await forceDeleteLocalRecord('trainings', item.id);
                          try { await forceSync(); } catch { /* breaker open is fine */ }
                        }}
                      />
                    ))}
                    {unsyncedAssessments.map((item) => (
                      <PendingReportRow
                        key={item.id}
                        kind="ASM"
                        accent="amber"
                        label={item.organization || item.site || 'Untitled'}
                        onDrop={async () => {
                          await forceDeleteLocalRecord('daily_assessments', item.id);
                          try { await forceSync(); } catch { /* breaker open is fine */ }
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Pending photos — Sprint 1D: 3-row breakdown (READY/RETRYING/STUCK).
                Header + gate source from bucket sum (not unsyncedPhotoCount) so
                photos in active backoff stay counted under PENDING_PHOTOS while
                they wait — getUnuploadedPhotos excludes nextRetryAt > now, but
                bucketPhotos correctly classifies those as RETRYING. */}
            {photoBucketTotal > 0 && (
              <div className="space-y-1 border-t border-green-900/40 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingPhotosExpanded(v => !v)}
                  aria-expanded={pendingPhotosExpanded}
                  style={{ touchAction: 'manipulation' }}
                  className="w-full min-h-[44px] flex items-center justify-between text-left text-green-400 text-[10px] uppercase tracking-wider hover:text-green-300 active:text-green-300 py-2 -my-1"
                >
                  <span>{pendingPhotosExpanded ? '▾' : '▸'} Pending photos ({photoBucketTotal})</span>
                  <span className="text-green-700 text-[9px]">{pendingPhotosExpanded ? 'TAP TO HIDE' : 'TAP TO OPEN'}</span>
                </button>
                {pendingPhotosExpanded && (
                  <div className="space-y-1">
                    {photoBuckets.ready > 0 && (
                      <div className="flex items-center justify-between pl-3 text-green-300/80">
                        <span className="text-green-400">▸ READY</span>
                        <span>{photoBuckets.ready}</span>
                      </div>
                    )}
                    {photoBuckets.retrying > 0 && (
                      <div className="flex items-center justify-between pl-3 text-green-300/80">
                        <span className="text-amber-400">
                          ▸ RETRYING
                          {photoBuckets.retryingMinNextRetryAt && (
                            <span className="ml-1 text-amber-300/70 font-mono text-[10px]">
                              ({formatRetryCountdown(photoBuckets.retryingMinNextRetryAt, retryingTick)})
                            </span>
                          )}
                        </span>
                        <span>{photoBuckets.retrying}</span>
                      </div>
                    )}
                    {photoBuckets.stuck > 0 && (
                      <div className="flex items-center justify-between pl-3 text-red-300/90">
                        <span className="flex items-center gap-1.5">
                          <span className="text-red-400">▸ STUCK</span>
                          <button
                            type="button"
                            disabled={retrying}
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                setRetrying(true);
                                const ids = photoBuckets.stuckIds;
                                if (ids.length > 0) {
                                  await resetPhotoRetryCounts(ids);
                                }
                                await updatePhotoCount();
                                const fresh = await getPhotoRetryBuckets();
                                setPhotoBuckets(fresh);
                                resetLayerBreakerOnUserActivity('SyncPulse retry'); await forceSync();
                              } catch (err) {
                                console.warn('[SyncPulse] Stuck-photo retry failed:', err);
                              } finally {
                                setRetrying(false);
                              }
                            }}
                            className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-red-700/60 text-red-300 hover:bg-red-900/30 disabled:opacity-50"
                          >
                            {retrying ? 'RETRYING…' : 'RETRY NOW'}
                          </button>
                        </span>
                        <span>{photoBuckets.stuck}</span>
                      </div>
                    )}
                    {photoBuckets.blocked > 0 && (
                      <div
                        className="flex items-center justify-between text-amber-300"
                        title={`Parent record(s) still on temp ID: ${photoBuckets.blockedParentIds.slice(0, 3).join(', ')}${photoBuckets.blockedParentIds.length > 3 ? '…' : ''}`}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="text-amber-400">▸ BLOCKED</span>
                          <span className="opacity-70">— parent not synced</span>
                        </span>
                        <span>{photoBuckets.blocked}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* PR #2: STUCK_VALIDATION — parent records that would currently
                fail client-side validation at sync time. Companion to PR #178's
                form-side gate: prevents new occurrences forward, surfaces
                existing stranded ones so the user can recover them in-place. */}
            {validationStuck.count > 0 && (
              <div className="space-y-1.5 border-t border-green-900/40 pt-2">
                <button
                  type="button"
                  onClick={() => setStuckValidationExpanded(v => !v)}
                  aria-expanded={stuckValidationExpanded}
                  style={{ touchAction: 'manipulation' }}
                  className="w-full min-h-[44px] flex items-center justify-between text-left text-[10px] uppercase tracking-wider text-red-300 hover:text-red-200 active:text-red-200 py-2 -my-1"
                >
                  <span>{stuckValidationExpanded ? '▾' : '▸'} Stuck validation ({validationStuck.count})</span>
                  <span className="text-green-700 text-[9px]">{stuckValidationExpanded ? 'TAP TO HIDE' : 'TAP TO OPEN'}</span>
                </button>
                {stuckValidationExpanded && (
                  <>
                    <p className="text-green-700 text-[10px] italic">
                      ▸ These records can't sync until the listed fields are filled in.
                    </p>
                    <div className="space-y-1">
                      {validationStuck.records.map((record) => {
                        const kindLabel =
                          record.kind === 'inspection' ? 'INSP'
                          : record.kind === 'training' ? 'TRN'
                          : 'ASM';
                        const missingDisplay = record.missingFields.length > 0
                          ? record.missingFields.join(', ')
                          : 'required fields';
                        return (
                          <div
                            key={`${record.kind}-${record.id}`}
                            className="flex items-start justify-between gap-2 pl-3 border-l border-red-500/50 text-red-300/90"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-bold uppercase tracking-wider text-red-400">
                                  {kindLabel}
                                </span>
                                <span className="truncate">{record.label}</span>
                              </div>
                              <div className="text-[10px] text-red-300/70 truncate">
                                Missing: {missingDisplay}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpen(false);
                                navigate(record.deepLinkPath);
                              }}
                              className="flex-shrink-0 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-red-700/60 text-red-300 hover:bg-red-900/30"
                            >
                              FIX
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* S39: Held-back records (regression guard). */}
            {regressionSkipCount > 0 && (
              <div className="space-y-1 border-t border-green-900/40 pt-2">
                <button
                  type="button"
                  onClick={() => setHeldBackExpanded(v => !v)}
                  aria-expanded={heldBackExpanded}
                  style={{ touchAction: 'manipulation' }}
                  className="w-full min-h-[44px] flex items-center justify-between text-left text-[10px] uppercase tracking-wider text-green-300/80 hover:text-green-200 active:text-green-200 py-2 -my-1"
                >
                  <span>{heldBackExpanded ? '▾' : '▸'} Held back ({regressionSkipCount})</span>
                  <span className="text-green-700 text-[9px]">{heldBackExpanded ? 'TAP TO HIDE' : 'TAP TO OPEN'}</span>
                </button>
                {heldBackExpanded && (
                  <p className="text-green-700 text-[10px] italic pl-3">
                    ▸ Tap diagnostics for details
                  </p>
                )}
              </div>
            )}

            {/* S41: session-quarantined records the sync gave up on this session */}
            {quarantinedCount > 0 && (
              <div className="space-y-1.5 border-t border-green-900/40 pt-2">
                <button
                  type="button"
                  onClick={() => setQuarantinedExpanded(v => !v)}
                  aria-expanded={quarantinedExpanded}
                  style={{ touchAction: 'manipulation' }}
                  className="w-full min-h-[44px] flex items-center justify-between text-left text-[10px] uppercase tracking-wider text-amber-400 hover:text-amber-300 active:text-amber-300 py-2 -my-1"
                >
                  <span>{quarantinedExpanded ? '▾' : '▸'} Quarantined ({quarantinedCount})</span>
                  <span className="text-green-700 text-[9px]">{quarantinedExpanded ? 'TAP TO HIDE' : 'TAP TO OPEN'}</span>
                </button>
                {quarantinedExpanded && (
                  <div className="space-y-1.5 pl-3">
                    <button
                      type="button"
                      disabled={retrying}
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          setRetrying(true);
                          clearAllQuarantines();
                          setQuarantinedCount(0);
                          resetLayerBreakerOnUserActivity('SyncPulse retry'); await forceSync();
                        } catch (err) {
                          console.warn('[SyncPulse] Quarantine retry failed:', err);
                        } finally {
                          setRetrying(false);
                        }
                      }}
                      className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-amber-700/60 text-amber-300 hover:bg-amber-900/30 disabled:opacity-50"
                    >
                      {retrying ? 'RETRYING…' : 'RETRY NOW'}
                    </button>
                    <p className="text-green-700 text-[10px] italic">
                      Sync paused after repeated failures. Auto-retries tomorrow, or tap Retry Now.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Failed (dead-letter) photos — retry-exhausted or orphaned */}
            {deadLetterCount > 0 && (
              <div className="space-y-1.5 border-t border-green-900/40 pt-2">
                <button
                  type="button"
                  onClick={() => setFailedPhotosExpanded(v => !v)}
                  aria-expanded={failedPhotosExpanded}
                  style={{ touchAction: 'manipulation' }}
                  className="w-full min-h-[44px] flex items-center justify-between text-left text-[10px] uppercase tracking-wider text-green-400 hover:text-green-300 active:text-green-300 py-2 -my-1"
                >
                  <span>{failedPhotosExpanded ? '▾' : '▸'} Failed photos ({deadLetterCount})</span>
                  <span className="text-green-700 text-[9px]">{failedPhotosExpanded ? 'TAP TO HIDE' : 'TAP TO OPEN'}</span>
                </button>
                {failedPhotosExpanded && (
                  <div className="space-y-1.5 pl-3">
                    <button
                      type="button"
                      disabled={retrying}
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          setRetrying(true);
                          const dead = await getDeadLetterPhotos();
                          const ids = dead.map((p: any) => p.id);
                          if (ids.length > 0) {
                            await resetPhotoRetryCounts(ids);
                          }
                          await updatePhotoCount();
                          resetLayerBreakerOnUserActivity('SyncPulse retry'); await forceSync();
                        } catch (err) {
                          console.warn('[SyncPulse] Retry failed:', err);
                        } finally {
                          setRetrying(false);
                        }
                      }}
                      className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-amber-700/60 text-amber-300 hover:bg-amber-900/30 disabled:opacity-50"
                    >
                      {retrying ? 'RETRYING…' : 'RETRY'}
                    </button>
                    <p className="text-green-700 text-[10px] italic">
                      These photos exhausted upload retries or have no parent record. Tap Retry to attempt again.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Orphan records — temp-* rows owned by another user (shared device leftovers). */}
            {diag.orphanRecords.length > 0 && (
              <div className="space-y-1.5 border-t border-green-900/40 pt-2">
                <button
                  type="button"
                  onClick={() => setOrphanRecordsExpanded(v => !v)}
                  aria-expanded={orphanRecordsExpanded}
                  style={{ touchAction: 'manipulation' }}
                  className="w-full min-h-[44px] flex items-center justify-between text-left text-[10px] uppercase tracking-wider text-amber-400 hover:text-amber-300 active:text-amber-300 py-2 -my-1"
                >
                  <span>{orphanRecordsExpanded ? '▾' : '▸'} Orphan records ({diag.orphanRecords.length})</span>
                  <span className="text-green-700 text-[9px]">{orphanRecordsExpanded ? 'TAP TO HIDE' : 'TAP TO OPEN'}</span>
                </button>
                {orphanRecordsExpanded && (
                  <>
                    <p className="text-green-700 text-[10px] italic">
                      These were started on this device by another sign-in and won't sync as you. Reassign to push under your account, or remove.
                    </p>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {diag.orphanRecords.map((o) => (
                        <div key={o.id} className="flex items-center justify-between gap-2 pl-2 border-l border-amber-500/40">
                          <span className="text-green-300/80 truncate text-[10px]">
                            <span className="text-amber-400 mr-1.5">{o.table.slice(0,3).toUpperCase()}</span>
                            {o.organization || 'Untitled'}
                          </span>
                          <span className="flex gap-1 shrink-0">
                            <button
                              type="button"
                              disabled={busyOrphanId === o.id}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setBusyOrphanId(o.id);
                                try {
                                  await reassignOrphanToCurrentUser(o.table, o.id);
                                  await refreshDiagnostics();
                                  resetLayerBreakerOnUserActivity('SyncPulse retry'); await forceSync();
                                } finally { setBusyOrphanId(null); }
                              }}
                              className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-green-700/60 text-green-300 hover:bg-green-900/30 disabled:opacity-50"
                            >REASSIGN</button>
                            <button
                              type="button"
                              disabled={busyOrphanId === o.id}
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!confirm('Permanently remove this orphan record from this device?')) return;
                                setBusyOrphanId(o.id);
                                try {
                                  await deleteOrphanLocally(o.table, o.id);
                                  await refreshDiagnostics();
                                } finally { setBusyOrphanId(null); }
                              }}
                              className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-red-700/60 text-red-300 hover:bg-red-900/30 disabled:opacity-50"
                            >DELETE</button>
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Temp-parent photos — photos still pinned to a temp-* parent. */}
            {diag.tempParentPhotos.length > 0 && (
              <div className="flex items-center justify-between text-green-300/80 border-t border-green-900/40 pt-2">
                <span>TEMP_PARENT_PHOTOS</span>
                <span className="text-amber-400">{diag.tempParentPhotos.length}</span>
              </div>
            )}

            {/* Error — soft (amber) for stats/photo-counts hiccups, red for fatal pipeline failure */}
            {syncError && (
              <p className={cn(
                'text-[10px] rounded px-2 py-1.5 border',
                isFatalError
                  ? 'text-red-400 bg-red-950/40 border-red-900/40'
                  : 'text-amber-400 bg-amber-950/30 border-amber-900/40',
              )}>
                {isFatalError ? 'ERR' : 'NOTE'}: {syncError}
              </p>
            )}

            {/* Offline notice */}
            {!isOnline && (
              <p className="text-green-600 text-[10px]">▸ Changes will sync when back online.</p>
            )}

            {/* Self-check — proves whether JWT + RLS visibility are healthy. */}
            <div className="space-y-1.5 border-t border-green-900/40 pt-2">
              <button
                type="button"
                onClick={() => setSelfCheckExpanded(v => !v)}
                aria-expanded={selfCheckExpanded}
                className="w-full flex items-center justify-between text-left text-green-400 text-[10px] uppercase tracking-wider hover:text-green-300 active:text-green-300 py-1 -my-1"
              >
                <span>{selfCheckExpanded ? '▾' : '▸'} Self-check</span>
                <span className="text-green-700 text-[9px]">{selfCheckExpanded ? 'TAP TO HIDE' : 'TAP TO OPEN'}</span>
              </button>
              {selfCheckExpanded && (
                <div className="space-y-1.5 pl-3">
                  <button
                    type="button"
                    disabled={selfCheckRunning || !isOnline}
                    onClick={runSelfCheck}
                    className="w-full text-[10px] uppercase tracking-wider px-2 py-1.5 rounded border border-green-700/60 text-green-300 hover:bg-green-900/30 disabled:opacity-50"
                  >
                    {selfCheckRunning ? 'RUNNING…' : 'RUN SELF-CHECK'}
                  </button>
                  {selfCheckResult && (
                    <p className={cn(
                      'text-[10px] rounded px-2 py-1 border',
                      selfCheckResult.ok
                        ? 'text-green-300 bg-green-950/30 border-green-900/40'
                        : 'text-amber-300 bg-amber-950/30 border-amber-900/40',
                    )}>
                      {selfCheckResult.label}{selfCheckResult.detail ? `: ${selfCheckResult.detail}` : ''}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/*
             * Sprint 2 I — one-shot "Why is my sync stuck?" diagnostic. Runs
             * every gate the sync engine consults (online, breaker, auth,
             * IDB readability, halt state, photos by bucket, records by
             * table, quarantine count) and renders the JSON directly so the
             * user can copy/paste it back to support without a screenshot.
             */}
            <div className="space-y-1.5 border-t border-green-900/40 pt-2">
              <button
                type="button"
                onClick={() => setDiagnosticExpanded(v => !v)}
                aria-expanded={diagnosticExpanded}
                className="w-full flex items-center justify-between text-left text-green-400 text-[10px] uppercase tracking-wider hover:text-green-300 active:text-green-300 py-1 -my-1"
              >
                <span>{diagnosticExpanded ? '▾' : '▸'} Diagnostic</span>
                <span className="text-green-700 text-[9px]">{diagnosticExpanded ? 'TAP TO HIDE' : 'TAP TO OPEN'}</span>
              </button>
              {diagnosticExpanded && (
                <div className="space-y-1.5 pl-3">
                  <button
                    type="button"
                    disabled={diagnosticRunning}
                    onClick={async () => {
                      setDiagnosticRunning(true);
                      setDiagnosticCopied(false);
                      try {
                        const report = await runSyncDiagnostic();
                        setDiagnosticReport(report);
                      } catch (e) {
                        console.warn('[SyncPulse] Diagnostic threw:', e);
                      } finally {
                        setDiagnosticRunning(false);
                      }
                    }}
                    className="w-full text-[10px] uppercase tracking-wider px-2 py-1.5 rounded border border-green-700/60 text-green-300 hover:bg-green-900/30 disabled:opacity-50"
                  >
                    {diagnosticRunning ? 'PROBING…' : 'RUN DIAGNOSTIC'}
                  </button>
                  {diagnosticReport && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-green-700 text-[9px] italic">
                          Captured {new Date(diagnosticReport.timestamp).toLocaleTimeString()}
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            const text = formatSyncDiagnostic(diagnosticReport);
                            try {
                              if (navigator.clipboard?.writeText) {
                                await navigator.clipboard.writeText(text);
                                setDiagnosticCopied(true);
                                setTimeout(() => setDiagnosticCopied(false), 2500);
                              }
                            } catch {
                              // Clipboard can fail in non-secure contexts or if the
                              // user denied permission. The `<pre>` below already
                              // shows the text, so the user can long-press to
                              // select / copy manually.
                            }
                          }}
                          className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-green-700/60 text-green-300 hover:bg-green-900/30"
                        >
                          {diagnosticCopied ? 'COPIED ✓' : 'COPY'}
                        </button>
                      </div>
                      <pre className="text-[9px] leading-snug font-mono text-green-300/90 bg-black/40 border border-green-900/40 rounded px-2 py-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-all">
                        {formatSyncDiagnostic(diagnosticReport)}
                      </pre>
                      <p className="text-green-700 text-[9px] italic">
                        Tap COPY (or long-press the text above to select) and paste this into a reply email so we can triage without a screenshot.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* TEMPORARY: Storage-source diagnostic. Read-only. Surfaces
                exactly where each remaining pending report is stored
                (IDB rows, rw_backup_ ledger, quarantine sessionStorage,
                validation-stuck bucket, or stale React state) so we can
                triage the "phantom rows after Hard Reset" report
                without guessing. Nothing is mutated. */}
            <div className="space-y-1.5 border-t border-amber-900/40 pt-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-amber-400 text-[10px] uppercase tracking-wider">
                  ▸ Storage source diagnostic (temp)
                </span>
                {storageDiagReport && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(storageDiagReport);
                        setStorageDiagCopied(true);
                        setTimeout(() => setStorageDiagCopied(false), 2000);
                      } catch {
                        /* clipboard may be denied — user can still select the <pre> */
                      }
                    }}
                    className="text-[10px] uppercase tracking-wider px-2 py-1 rounded border border-amber-600/70 text-amber-300 hover:bg-amber-900/30 min-h-[28px]"
                  >
                    {storageDiagCopied ? 'COPIED ✓' : 'COPY'}
                  </button>
                )}
              </div>
              <p className="text-amber-300/70 text-[10px] leading-relaxed">
                Read-only. Dumps IDB unsynced rows, rw_backup_ ledger,
                quarantine map, validation-stuck bucket, and matching
                storage keys. Nothing is deleted.
              </p>
              <button
                type="button"
                disabled={storageDiagRunning}
                onClick={async () => {
                  setStorageDiagRunning(true);
                  setStorageDiagReport(null);
                  try {
                    const user = await getUserWithCache();
                    const report = await runStorageSourceDiagnostic({
                      unsyncedCount,
                      unsyncedInspections: unsyncedInspections.length,
                      unsyncedTrainings: unsyncedTrainings.length,
                      unsyncedAssessments: unsyncedAssessments.length,
                      quarantinedCount,
                      currentUserId: user?.id ?? null,
                    });
                    setStorageDiagReport(JSON.stringify(report, null, 2));
                  } catch (e) {
                    setStorageDiagReport(
                      JSON.stringify(
                        { error: e instanceof Error ? e.message : String(e) },
                        null,
                        2,
                      ),
                    );
                  } finally {
                    setStorageDiagRunning(false);
                  }
                }}
                className="w-full text-[10px] uppercase tracking-wider px-2 py-1.5 rounded border border-amber-600/70 text-amber-300 hover:bg-amber-900/30 disabled:opacity-50 min-h-[36px]"
              >
                {storageDiagRunning ? 'COLLECTING…' : 'SHOW STORAGE SOURCE DIAGNOSTIC'}
              </button>
              {storageDiagReport && (
                <pre className="mt-1 max-h-[40vh] overflow-auto whitespace-pre-wrap break-all rounded border border-amber-900/40 bg-black/50 p-2 text-[10px] text-amber-200/90 leading-snug select-all">
                  {storageDiagReport}
                </pre>
              )}
            </div>

            {/* Last-resort recovery: nukes the offline IndexedDB and all
                service workers, then hard-reloads. Auth lives in
                localStorage and is preserved, so the user stays signed in. */}
            <div className="space-y-1.5 border-t border-red-900/40 pt-2">
              <div className="flex flex-col gap-1">
                <span className="text-red-400 text-[10px] uppercase tracking-wider">
                  ▸ Danger zone
                </span>
                <p className="text-red-300/70 text-[10px] leading-relaxed">
                  Wipes the local offline database and reloads the app. Your
                  login is preserved, but any unsynced drafts on this device
                  will be lost. Use only if sync is completely stuck.
                </p>
                <button
                  type="button"
                  disabled={hardResetting}
                  onClick={async () => {
                    const ok = window.confirm(
                      'HARD RESET DATABASE\n\nThis will erase the offline database on this device and reload the app. Any unsynced drafts will be permanently lost. Your login will be preserved.\n\nContinue?',
                    );
                    if (!ok) return;
                    setHardResetting(true);
                    try {
                      await hardResetDatabase();
                    } catch (e) {
                      console.error('[SyncPulse] Hard reset failed:', e);
                      setHardResetting(false);
                      window.alert('Hard reset failed. Try closing all other tabs of this app, then try again.');
                    }
                  }}
                  className="w-full text-[10px] uppercase tracking-wider px-2 py-1.5 rounded border border-red-600/70 text-red-300 hover:bg-red-900/30 disabled:opacity-50 min-h-[36px]"
                >
                  {hardResetting ? 'RESETTING…' : 'HARD RESET DATABASE'}
                </button>
              </div>
            </div>

            <p className="text-green-700 text-[10px] italic pt-1 border-t border-green-900/40">
              Auto-sync runs in background.
              {isIOSDevice && ' iOS: visibility change + 30s interval.'}
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

type AccentName = 'blue' | 'purple' | 'amber';

const ACCENT_BORDER: Record<AccentName, string> = {
  blue: 'border-blue-500/50',
  purple: 'border-purple-500/50',
  amber: 'border-amber-500/50',
};
const ACCENT_TEXT: Record<AccentName, string> = {
  blue: 'text-blue-400',
  purple: 'text-purple-400',
  amber: 'text-amber-400',
};

function PendingReportRow({
  kind,
  accent,
  label,
  sublabel,
  onDrop,
}: {
  kind: string;
  accent: AccentName;
  label: string;
  sublabel?: string;
  onDrop: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const handleDrop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    const ok = window.confirm(
      `Discard the local draft "${label}"?\n\nThis cannot be undone. Use this only if the report no longer exists or is stuck syncing.`,
    );
    if (!ok) return;
    try {
      setBusy(true);
      await onDrop();
    } catch (err) {
      console.error('[SyncPulse] Drop failed:', err);
      window.alert('Could not drop the local draft. Try RECOVER STORAGE first, then try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`pl-3 border-l ${ACCENT_BORDER[accent]} text-green-300/70 flex items-center justify-between gap-2`}>
      <div className="min-w-0 flex-1 truncate">
        <span className={`text-[9px] font-bold uppercase tracking-wider ${ACCENT_TEXT[accent]} mr-1.5`}>{kind}</span>
        <span className="truncate">{label}</span>
        {sublabel && <span className="text-green-600 ml-1">{sublabel}</span>}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={handleDrop}
        style={{ touchAction: 'manipulation' }}
        className="shrink-0 min-h-[32px] px-2 text-[9px] uppercase tracking-wider text-red-400 hover:text-red-300 active:text-red-300 disabled:opacity-50 border border-red-900/60 hover:border-red-500/60 rounded-sm"
        aria-label={`Drop local draft ${label}`}
      >
        {busy ? '…' : 'DROP'}
      </button>
    </div>
  );
}
