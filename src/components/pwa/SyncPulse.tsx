import { useState, useEffect, useCallback } from 'react';
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
import { getDeadLetterPhotos, resetPhotoRetryCounts } from '@/lib/offline-storage';
import { useUnsyncedPhotos } from '@/hooks/useUnsyncedPhotos';
import { getQuarantineSnapshot, clearAllQuarantines } from '@/lib/sync-quarantine';
import {
  collectSyncDiagnostics,
  reassignOrphanToCurrentUser,
  deleteOrphanLocally,
  type SyncDiagnosticsReport,
} from '@/lib/sync-diagnostics';
import { supabase } from '@/integrations/supabase/client';

type Phase = 'idle' | 'syncing' | 'synced' | 'unsynced' | 'error';

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
    updatePhotoCount,
  } = usePWA();
  const { regressionSkipCount } = useUnsyncedPhotos();

  const isIOSDevice = isIOS();
  const [justSynced, setJustSynced] = useState(false);
  const [previousSyncingState, setPreviousSyncingState] = useState(false);
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [quarantinedCount, setQuarantinedCount] = useState(0);
  const [diag, setDiag] = useState<SyncDiagnosticsReport>({ orphanRecords: [], tempParentPhotos: [], partial: false });
  const [busyOrphanId, setBusyOrphanId] = useState<string | null>(null);
  const [selfCheckRunning, setSelfCheckRunning] = useState(false);
  const [selfCheckResult, setSelfCheckResult] = useState<null | {
    ok: boolean;
    label: string;
    detail?: string;
  }>(null);

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

  const totalUnsynced = unsyncedCount + unsyncedPhotoCount;

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
  let phase: Phase = 'idle';
  if (!isOnline) phase = 'error';
  else if (isFatalError) phase = 'error';
  else if (isSyncing) phase = 'syncing';
  else if (justSynced) phase = 'synced';
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
    : phase === 'unsynced' ? `${totalUnsynced} PENDING`
    : phase === 'synced' ? 'SYNCED'
    : 'ALL SYNCED';

  return (
    <>
      <button
        type="button"
        aria-label="Sync status"
        onClick={() => setOpen(true)}
        className={cn('relative flex items-center justify-center w-8 h-8', className)}
      >
        <div
          className={cn(
            'w-2 h-2 rounded-full transition-all duration-500 ease-in-out',
            phase === 'syncing' && 'bg-blue-500 opacity-90 animate-[pulse_2s_ease-in-out_infinite]',
            phase === 'error' && 'bg-destructive opacity-100',
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
            {/* Status row */}
            <div className="flex items-center justify-between text-green-300/80">
              <span>STATUS</span>
              <span className={cn(
                'font-bold px-2 py-0.5 rounded text-[10px] uppercase tracking-wider',
                phase === 'syncing' && 'bg-blue-900/50 text-blue-300',
                phase === 'error' && 'bg-red-900/50 text-red-300',
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

            {/* Pending reports */}
            {unsyncedCount > 0 && (
              <div className="space-y-1.5 border-t border-green-900/40 pt-2">
                <p className="text-green-400 text-[10px] uppercase tracking-wider">
                  ▸ Pending reports ({unsyncedCount})
                </p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {unsyncedInspections.map((item) => (
                    <div key={item.id} className="pl-3 border-l border-blue-500/50 text-green-300/70">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-blue-400 mr-1.5">INS</span>
                      <span className="truncate">{item.organization || 'Untitled'}</span>
                      {item.location && <span className="text-green-600 ml-1">@ {item.location}</span>}
                    </div>
                  ))}
                  {unsyncedTrainings.map((item) => (
                    <div key={item.id} className="pl-3 border-l border-purple-500/50 text-green-300/70">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-purple-400 mr-1.5">TRN</span>
                      <span className="truncate">{item.organization || 'Untitled'}</span>
                    </div>
                  ))}
                  {unsyncedAssessments.map((item) => (
                    <div key={item.id} className="pl-3 border-l border-amber-500/50 text-green-300/70">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 mr-1.5">ASM</span>
                      <span className="truncate">{item.organization || item.site || 'Untitled'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pending photos */}
            {unsyncedPhotoCount > 0 && (
              <div className="flex items-center justify-between text-green-300/80">
                <span>PENDING_PHOTOS</span>
                <span className="text-amber-400">{unsyncedPhotoCount}</span>
              </div>
            )}

            {/* S39: Held-back records (regression guard). Read-only here; deep actions live in SyncDiagnosticsSheet. */}
            {regressionSkipCount > 0 && (
              <div className="space-y-1 border-t border-green-900/40 pt-2">
                <div className="flex items-center justify-between text-green-300/80">
                  <span>HELD_BACK</span>
                  <span className="text-amber-400">{regressionSkipCount}</span>
                </div>
                <p className="text-green-700 text-[10px] italic">
                  ▸ Tap diagnostics for details
                </p>
              </div>
            )}

            {/* S41 (Fix E + option i): session-quarantined records the sync gave up on this session */}
            {quarantinedCount > 0 && (
              <div className="space-y-1.5 border-t border-green-900/40 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-amber-400 text-[10px] uppercase tracking-wider">
                    ▸ Quarantined ({quarantinedCount})
                  </span>
                  <button
                    type="button"
                    disabled={retrying}
                    onClick={async () => {
                      try {
                        setRetrying(true);
                        clearAllQuarantines();
                        setQuarantinedCount(0);
                        await forceSync();
                      } catch (e) {
                        console.warn('[SyncPulse] Quarantine retry failed:', e);
                      } finally {
                        setRetrying(false);
                      }
                    }}
                    className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-amber-700/60 text-amber-300 hover:bg-amber-900/30 disabled:opacity-50"
                  >
                    {retrying ? 'RETRYING…' : 'RETRY NOW'}
                  </button>
                </div>
                <p className="text-green-700 text-[10px] italic">
                  Sync paused after repeated failures. Auto-retries tomorrow, or tap Retry Now.
                </p>
              </div>
            )}

            {/* Failed (dead-letter) photos — retry-exhausted or orphaned */}
            {deadLetterCount > 0 && (
              <div className="space-y-1.5 border-t border-green-900/40 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-green-400 text-[10px] uppercase tracking-wider">
                    ▸ Failed photos ({deadLetterCount})
                  </span>
                  <button
                    type="button"
                    disabled={retrying}
                    onClick={async () => {
                      try {
                        setRetrying(true);
                        const dead = await getDeadLetterPhotos();
                        const ids = dead.map((p: any) => p.id);
                        if (ids.length > 0) {
                          await resetPhotoRetryCounts(ids);
                        }
                        await updatePhotoCount();
                        await forceSync();
                      } catch (e) {
                        console.warn('[SyncPulse] Retry failed:', e);
                      } finally {
                        setRetrying(false);
                      }
                    }}
                    className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-amber-700/60 text-amber-300 hover:bg-amber-900/30 disabled:opacity-50"
                  >
                    {retrying ? 'RETRYING…' : 'RETRY'}
                  </button>
                </div>
                <p className="text-green-700 text-[10px] italic">
                  These photos exhausted upload retries or have no parent record. Tap Retry to attempt again.
                </p>
              </div>
            )}

            {/* Orphan records — temp-* rows owned by another user (shared device leftovers). */}
            {diag.orphanRecords.length > 0 && (
              <div className="space-y-1.5 border-t border-green-900/40 pt-2">
                <p className="text-amber-400 text-[10px] uppercase tracking-wider">
                  ▸ Orphan records ({diag.orphanRecords.length})
                </p>
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
                          onClick={async () => {
                            setBusyOrphanId(o.id);
                            try {
                              await reassignOrphanToCurrentUser(o.table, o.id);
                              await refreshDiagnostics();
                              await forceSync();
                            } finally { setBusyOrphanId(null); }
                          }}
                          className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-green-700/60 text-green-300 hover:bg-green-900/30 disabled:opacity-50"
                        >REASSIGN</button>
                        <button
                          type="button"
                          disabled={busyOrphanId === o.id}
                          onClick={async () => {
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

            {/* Info footer */}
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
