import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Activity, RefreshCw, Trash2, X, AlertTriangle } from 'lucide-react';
import { usePWA } from '@/hooks/usePWA';
import { ForceSyncButton } from '@/components/pwa/ForceSyncButton';
import { getMobileCapabilities, checkStorageQuota } from '@/lib/mobile-detection';
import { isServiceWorkerAllowed } from '@/lib/environment';
import { getRecentTripwireBlockCount } from '@/lib/child-row-deletion-tripwire';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useUnsyncedPhotos, type DeadLetterPhotoInfo } from '@/hooks/useUnsyncedPhotos';
import {
  resetPhotoForRetry,
  deleteOfflinePhoto,
  getDeadLetterSoftDeletes,
  removeDeadLetterSoftDelete,
  listPhotoUploadFailures,
  removePhotoUploadFailure,
  type DeadLetterSoftDelete,
  type PhotoUploadFailureEntry,
  getEmergencyFallbackFailures,
  type EmergencyFallbackFailure,
} from '@/lib/offline-storage';
import { retryDeadLetterSoftDelete } from '@/lib/queued-soft-delete-processor';
import {
  resetRegressionSkipCount,
  type RegressionSkipEntry,
} from '@/lib/regression-skip-store';
import { MAX_REGRESSION_SKIPS } from '@/lib/atomic-sync-manager';
import {
  getOfflineInspection,
  getOfflineTraining,
  getOfflineDailyAssessment,
  saveInspectionOffline,
  saveTrainingOffline,
  saveDailyAssessmentOffline,
  saveRelatedDataOffline,
  saveTrainingDataOffline,
  saveAssessmentDataOffline,
} from '@/lib/offline-storage';
import {
  listEmptyLocalConflicts,
  clearEmptyLocalConflict,
  type EmptyLocalConflictEntry,
} from '@/lib/empty-local-conflict-store';
import { markUserCleared } from '@/lib/clear-intent';
import { supabase } from '@/integrations/supabase/client';
import {
  getSyncSkipCounters,
  resetSyncSkipCounters,
  type SyncSkipCountersSnapshot,
} from '@/lib/sync-skip-counters';

interface DiagnosticsState {
  swRegistered: boolean;
  swController: boolean;
  swWaiting: boolean;
  storageUsageMB: number;
  storageQuotaMB: number;
  storagePercent: number;
  tripwireBlocks24h: number;
}

const formatDate = (d: Date | null) => (d ? format(d, 'PPp') : '—');

/**
 * Small "Sync diagnostics" panel for end-users to self-diagnose sync/update
 * issues without needing developer tools. Especially useful on iPad where
 * sync misbehavior is usually due to environmental/iOS Safari constraints.
 */
export const SyncDiagnosticsSheet = () => {
  const {
    isOnline,
    isSyncing,
    lastSyncTime,
    unsyncedCount,
    unsyncedPhotoCount,
    needsUpdate,
    lastUpdateCheck,
    isCheckingForUpdate,
    checkForUpdates,
  } = usePWA();
  const { deadLetterPhotos, regressionSkipEntries, updatePhotoCount } = useUnsyncedPhotos();
  const { forceSync } = usePWA();
  const [open, setOpen] = useState(false);
  const [busyPhotoId, setBusyPhotoId] = useState<string | null>(null);
  const [deadLetterDeletes, setDeadLetterDeletes] = useState<DeadLetterSoftDelete[]>([]);
  const [busyDeadLetterId, setBusyDeadLetterId] = useState<string | null>(null);
  const [busyHeldBackId, setBusyHeldBackId] = useState<string | null>(null);
  const [heldBackLabels, setHeldBackLabels] = useState<Record<string, string>>({});
  const [emptyLocalConflicts, setEmptyLocalConflicts] = useState<EmptyLocalConflictEntry[]>([]);
  const [busyConflictId, setBusyConflictId] = useState<string | null>(null);
  const [photoFailures, setPhotoFailures] = useState<PhotoUploadFailureEntry[]>([]);
  const [busyPhotoFailureId, setBusyPhotoFailureId] = useState<string | null>(null);
  const [emergencyFailures, setEmergencyFailures] = useState<EmergencyFallbackFailure[]>([]);
  const [copyingDiag, setCopyingDiag] = useState(false);
  const [diag, setDiag] = useState<DiagnosticsState>({
    swRegistered: false,
    swController: false,
    swWaiting: false,
    storageUsageMB: 0,
    storageQuotaMB: 0,
    storagePercent: 0,
    tripwireBlocks24h: 0,
  });

  const refresh = async () => {
    let swRegistered = false;
    let swController = false;
    let swWaiting = false;
    if (isServiceWorkerAllowed()) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        swRegistered = !!reg;
        swWaiting = !!reg?.waiting;
        swController = !!navigator.serviceWorker.controller;
      } catch {
        // ignore
      }
    }
    const storage = await checkStorageQuota();
    const tripwireBlocks24h = await getRecentTripwireBlockCount(24).catch(() => 0);
    const dlDeletes = await getDeadLetterSoftDeletes().catch(() => []);
    setDeadLetterDeletes(dlDeletes);
    const conflicts = await listEmptyLocalConflicts().catch(() => [] as EmptyLocalConflictEntry[]);
    setEmptyLocalConflicts(conflicts);
    const failures = await listPhotoUploadFailures().catch(() => [] as PhotoUploadFailureEntry[]);
    setPhotoFailures(failures);
    try {
      setEmergencyFailures(getEmergencyFallbackFailures());
    } catch {
      setEmergencyFailures([]);
    }
    setDiag({
      swRegistered,
      swController,
      swWaiting,
      storageUsageMB: storage.usage / 1024 / 1024,
      storageQuotaMB: storage.quota / 1024 / 1024,
      storagePercent: storage.percentUsed,
      tripwireBlocks24h,
    });
  };

  useEffect(() => {
    if (!open) return;
    void refresh();
    const interval = setInterval(() => {
      try {
        setEmergencyFailures(getEmergencyFallbackFailures());
      } catch {
        /* ignore */
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [open]);

  // S39: best-effort resolve organization/title labels for held-back records.
  useEffect(() => {
    if (!open || regressionSkipEntries.length === 0) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const entry of regressionSkipEntries) {
        const id = entry.id;
        try {
          const ins = await getOfflineInspection(id).catch(() => null);
          if (ins) {
            next[id] = (ins as any).organization || (ins as any).location || '';
            continue;
          }
          const trn = await getOfflineTraining(id).catch(() => null);
          if (trn) {
            next[id] = (trn as any).organization || '';
            continue;
          }
          const asm = await getOfflineDailyAssessment(id).catch(() => null);
          if (asm) {
            next[id] = (asm as any).organization || (asm as any).site || '';
            continue;
          }
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setHeldBackLabels(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, regressionSkipEntries]);

  const caps = getMobileCapabilities();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Activity className="h-4 w-4" />
          Sync Diagnostics
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Sync Diagnostics</SheetTitle>
          <SheetDescription>
            Live information about how this device is syncing and updating.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6 text-sm">
          <Section title="Connectivity">
            <Row label="Online" value={isOnline ? 'Yes' : 'No'} />
            <Row label="Currently syncing" value={isSyncing ? 'Yes' : 'No'} />
            <Row label="Last sync" value={formatDate(lastSyncTime)} />
            <Row label="Pending records" value={String(unsyncedCount)} />
            <Row label="Pending photos" value={String(unsyncedPhotoCount)} />
          </Section>

          <Section title="App Updates">
            <Row label="Installed version" value={`v${import.meta.env.APP_VERSION || '0.0.0'}`} />
            <Row label="Update available" value={needsUpdate ? 'Yes' : 'No'} />
            <Row label="Last update check" value={formatDate(lastUpdateCheck)} />
            <Row label="Service worker registered" value={diag.swRegistered ? 'Yes' : 'No'} />
            <Row label="Service worker controlling" value={diag.swController ? 'Yes' : 'No'} />
            <Row label="Update waiting" value={diag.swWaiting ? 'Yes' : 'No'} />
          </Section>

          <Section title="Device & Storage">
            <Row label="Platform" value={caps.isIOS ? 'iOS' : caps.isAndroid ? 'Android' : 'Desktop'} />
            <Row label="Browser" value={caps.browser} />
            <Row label="Installed (PWA)" value={caps.isPWA ? 'Yes' : 'No'} />
            <Row label="Background Sync API" value={caps.hasBackgroundSync ? 'Yes' : 'No'} />
            <Row
              label="Storage used"
              value={`${diag.storageUsageMB.toFixed(1)} MB / ${diag.storageQuotaMB.toFixed(0)} MB (${diag.storagePercent.toFixed(0)}%)`}
            />
          </Section>

          <Section title="Data Safety">
            <Row label="Child-row deletions blocked (24 h)" value={String(diag.tripwireBlocks24h)} />
          </Section>

          {deadLetterPhotos.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Stuck Photos ({deadLetterPhotos.length})
              </h3>
              <div className="rounded-md border border-border divide-y divide-border">
                {deadLetterPhotos.map((p) => (
                  <StuckPhotoRow
                    key={p.id}
                    photo={p}
                    busy={busyPhotoId === p.id}
                    onRetry={async () => {
                      setBusyPhotoId(p.id);
                      try {
                        const ok = await resetPhotoForRetry(p.id);
                        if (ok) {
                          toast.success('Photo queued for retry');
                          await updatePhotoCount();
                        } else {
                          toast.error('Could not reset photo');
                        }
                      } finally {
                        setBusyPhotoId(null);
                      }
                    }}
                    onDiscard={async () => {
                      if (!confirm('Discard this photo? It will be removed from this device.')) return;
                      setBusyPhotoId(p.id);
                      try {
                        await deleteOfflinePhoto(p.id);
                        toast.success('Photo discarded');
                        await updatePhotoCount();
                      } finally {
                        setBusyPhotoId(null);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {photoFailures.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                Failed Uploads ({photoFailures.length})
              </h3>
              <p className="text-xs text-muted-foreground mb-2">
                These photos exceeded the upload retry limit. They may be lost
                unless you retry or re-capture.
              </p>
              <div className="rounded-md border border-border divide-y divide-border">
                {photoFailures.map((entry) => (
                  <PhotoFailureRow
                    key={entry.id}
                    entry={entry}
                    busy={busyPhotoFailureId === entry.id}
                    onRetry={async () => {
                      setBusyPhotoFailureId(entry.id);
                      try {
                        const ok = await resetPhotoForRetry(entry.id);
                        await removePhotoUploadFailure(entry.id);
                        if (ok) {
                          toast.success('Photo queued for retry');
                        } else {
                          toast('Failure record cleared');
                        }
                        await refresh();
                        await updatePhotoCount();
                      } finally {
                        setBusyPhotoFailureId(null);
                      }
                    }}
                    onDismiss={async () => {
                      setBusyPhotoFailureId(entry.id);
                      try {
                        await removePhotoUploadFailure(entry.id);
                        toast('Failure dismissed');
                        await refresh();
                      } finally {
                        setBusyPhotoFailureId(null);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {emergencyFailures.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 backdrop-blur-xl p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-destructive mb-1 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Records lost this session ({emergencyFailures.length})
              </h3>
              <p className="text-xs text-foreground/90 mb-3">
                These records could not be saved to local storage. Reload may
                clear them — copy/screenshot before reloading.
              </p>
              <div className="rounded-md border border-destructive/30 bg-background/40 divide-y divide-destructive/20 max-h-72 overflow-y-auto">
                {emergencyFailures
                  .slice()
                  .reverse()
                  .map((f, idx) => {
                    const codeLabel =
                      f.code === 'localstorage_quota'
                        ? 'quota'
                        : f.code === 'localstorage_blocked'
                          ? 'blocked'
                          : 'unknown';
                    const badgeClass =
                      f.code === 'localstorage_quota'
                        ? 'bg-destructive/20 text-destructive border-destructive/40'
                        : f.code === 'localstorage_blocked'
                          ? 'bg-warning/20 text-warning-foreground border-warning/40'
                          : 'bg-muted text-muted-foreground border-border';
                    const kb = Math.max(1, Math.round(f.approxBytes / 1024));
                    const idShort = (f.id || 'unknown').slice(0, 8);
                    const ago = (() => {
                      try {
                        return formatDistanceToNow(new Date(f.ts), {
                          addSuffix: true,
                        });
                      } catch {
                        return '—';
                      }
                    })();
                    return (
                      <div
                        key={`${f.ts}-${idx}`}
                        className="px-2 py-1.5 text-xs flex items-center gap-2"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-foreground truncate">
                              {f.reportType} · {idShort}…
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold ${badgeClass}`}
                            >
                              {codeLabel}
                            </span>
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {f.operationName} · {ago}
                          </div>
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground shrink-0">
                          ~{kb} KB
                        </div>
                      </div>
                    );
                  })}
              </div>
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={copyingDiag}
                  onClick={async () => {
                    setCopyingDiag(true);
                    const payload = JSON.stringify(emergencyFailures, null, 2);
                    try {
                      if (navigator.clipboard && window.isSecureContext) {
                        await navigator.clipboard.writeText(payload);
                        toast.success('Diagnostics copied to clipboard');
                      } else {
                        throw new Error('Clipboard API unavailable');
                      }
                    } catch {
                      // Fallback: temporary textarea
                      try {
                        const ta = document.createElement('textarea');
                        ta.value = payload;
                        ta.style.position = 'fixed';
                        ta.style.opacity = '0';
                        document.body.appendChild(ta);
                        ta.focus();
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        toast.success('Diagnostics copied to clipboard');
                      } catch {
                        toast.error('Could not copy — try a screenshot instead');
                      }
                    } finally {
                      setTimeout(() => setCopyingDiag(false), 500);
                    }
                  }}
                >
                  Copy diagnostics
                </Button>
              </div>
            </div>
          )}

          {deadLetterDeletes.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Failed Deletions ({deadLetterDeletes.length})
              </h3>
              <div className="rounded-md border border-border divide-y divide-border">
                {deadLetterDeletes.map((entry) => (
                  <DeadLetterDeleteRow
                    key={entry.id}
                    entry={entry}
                    busy={busyDeadLetterId === entry.id}
                    onRetry={async () => {
                      setBusyDeadLetterId(entry.id);
                      try {
                        const ok = await retryDeadLetterSoftDelete(entry);
                        if (ok) {
                          toast.success('Deletion requeued for retry');
                          await refresh();
                        } else {
                          toast.error('Could not requeue deletion');
                        }
                      } finally {
                        setBusyDeadLetterId(null);
                      }
                    }}
                    onDiscard={async () => {
                      if (!confirm('Discard this failed deletion? The record will remain on the server.')) return;
                      setBusyDeadLetterId(entry.id);
                      try {
                        await removeDeadLetterSoftDelete(entry.id);
                        toast.success('Discarded');
                        await refresh();
                      } finally {
                        setBusyDeadLetterId(null);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {regressionSkipEntries.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Held-Back Records ({regressionSkipEntries.length})
              </h3>
              <div className="rounded-md border border-border divide-y divide-border">
                {regressionSkipEntries.map((entry) => (
                  <HeldBackRow
                    key={entry.id}
                    entry={entry}
                    label={heldBackLabels[entry.id]}
                    busy={busyHeldBackId === entry.id}
                    onForceRetry={async () => {
                      setBusyHeldBackId(entry.id);
                      try {
                        await resetRegressionSkipCount(entry.id);
                        await updatePhotoCount();
                        await forceSync();
                        toast.success('Force retry queued');
                      } catch {
                        toast.error('Could not force retry');
                      } finally {
                        setBusyHeldBackId(null);
                      }
                    }}
                    onResetCounter={async () => {
                      setBusyHeldBackId(entry.id);
                      try {
                        await resetRegressionSkipCount(entry.id);
                        await updatePhotoCount();
                        toast.success('Counter reset');
                      } finally {
                        setBusyHeldBackId(null);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {emptyLocalConflicts.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                Empty-Local Conflicts ({emptyLocalConflicts.length})
              </h3>
              <p className="text-xs text-muted-foreground mb-2">
                Local cache is empty for these reports but the server has data.
                Sync is paused until you choose how to resolve.
              </p>
              <div className="rounded-md border border-border divide-y divide-border">
                {emptyLocalConflicts.map((entry) => (
                  <EmptyLocalConflictRow
                    key={entry.id}
                    entry={entry}
                    busy={busyConflictId === entry.id}
                    onRestoreFromServer={async () => {
                      setBusyConflictId(entry.id);
                      try {
                        await restoreEmptyLocalFromServer(entry);
                        await clearEmptyLocalConflict(entry.id);
                        await refresh();
                        toast.success('Server data restored to this device');
                      } catch (err) {
                        console.error('[C2] restore failed:', err);
                        toast.error('Could not restore from server');
                      } finally {
                        setBusyConflictId(null);
                      }
                    }}
                    onConfirmLocalEmpty={async () => {
                      if (
                        !confirm(
                          'Confirm this report should be empty? On the next sync, the matching rows on the server will be deleted.',
                        )
                      ) {
                        return;
                      }
                      setBusyConflictId(entry.id);
                      try {
                        await confirmEmptyLocal(entry);
                        await clearEmptyLocalConflict(entry.id);
                        await refresh();
                        await forceSync();
                        toast.success('Marked empty — sync will clear server rows');
                      } catch (err) {
                        console.error('[C2] confirm-empty failed:', err);
                        toast.error('Could not confirm empty');
                      } finally {
                        setBusyConflictId(null);
                      }
                    }}
                    onDismiss={async () => {
                      setBusyConflictId(entry.id);
                      try {
                        await clearEmptyLocalConflict(entry.id);
                        await refresh();
                        toast('Conflict dismissed');
                      } finally {
                        setBusyConflictId(null);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 pt-2">
            <ForceSyncButton variant="default" />
            <Button
              variant="outline"
              onClick={async () => {
                await checkForUpdates();
                await refresh();
              }}
              disabled={isCheckingForUpdate}
            >
              {isCheckingForUpdate ? 'Checking…' : 'Check for app updates'}
            </Button>
            <Button variant="ghost" onClick={refresh}>
              Refresh diagnostics
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={async () => {
                if (!confirm('Force reload will clear the app cache and reload. Your saved data is preserved. Continue?')) return;
                toast.loading('Clearing cache…', { id: 'force-reload' });
                try {
                  if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(regs.map((r) => r.unregister()));
                  }
                  if ('caches' in window) {
                    const keys = await caches.keys();
                    await Promise.all(keys.map((k) => caches.delete(k)));
                  }
                  toast.dismiss('force-reload');
                  setTimeout(() => window.location.reload(), 300);
                } catch {
                  toast.dismiss('force-reload');
                  toast.error('Force reload failed');
                }
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Force reload (clear cache)
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
      {title}
    </h3>
    <div className="rounded-md border border-border divide-y divide-border">{children}</div>
  </div>
);

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between px-3 py-2">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-medium text-foreground">{value}</span>
  </div>
);

const StuckPhotoRow = ({
  photo,
  busy,
  onRetry,
  onDiscard,
}: {
  photo: DeadLetterPhotoInfo;
  busy: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) => (
  <div className="flex flex-col gap-2 px-3 py-2">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground truncate">
          {photo.fileName || photo.id}
        </div>
        {photo.section && (
          <div className="text-xs text-muted-foreground truncate">{photo.section}</div>
        )}
        <div className="text-xs text-muted-foreground">
          Retries: {photo.retryCount}
          {photo.lastErrorAt ? ` · ${format(new Date(photo.lastErrorAt), 'PPp')}` : ''}
        </div>
        {photo.lastError && (
          <div className="text-xs text-destructive mt-1 break-words">
            Last error: {photo.lastError}
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          disabled={busy}
          className="h-7 px-2"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Retry
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDiscard}
          disabled={busy}
          className="h-7 px-2 text-destructive hover:text-destructive"
        >
          <X className="h-3 w-3 mr-1" />
          Discard
        </Button>
      </div>
    </div>
  </div>
);

const DeadLetterDeleteRow = ({
  entry,
  busy,
  onRetry,
  onDiscard,
}: {
  entry: DeadLetterSoftDelete;
  busy: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) => (
  <div className="flex flex-col gap-2 px-3 py-2">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground truncate">
          {entry.table} · {entry.recordId}
        </div>
        <div className="text-xs text-muted-foreground">
          Attempts: {entry.attempts} · Dead-lettered {format(new Date(entry.deadLetteredAt), 'PPp')}
        </div>
        {entry.lastError && (
          <div className="text-xs text-destructive mt-1 break-words">
            Last error: {entry.lastError}
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          disabled={busy}
          className="h-7 px-2"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Retry
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDiscard}
          disabled={busy}
          className="h-7 px-2 text-destructive hover:text-destructive"
        >
          <X className="h-3 w-3 mr-1" />
          Discard
        </Button>
      </div>
    </div>
  </div>
);

const HeldBackRow = ({
  entry,
  label,
  busy,
  onForceRetry,
  onResetCounter,
}: {
  entry: RegressionSkipEntry;
  label?: string;
  busy: boolean;
  onForceRetry: () => void;
  onResetCounter: () => void;
}) => {
  const display = label?.trim() || entry.id.substring(0, 8);
  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground truncate">{display}</div>
          <div className="text-xs text-muted-foreground">
            Attempts: {entry.count} of {MAX_REGRESSION_SKIPS}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Sync paused — large data drop detected. Will auto-retry.
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={onForceRetry}
            disabled={busy}
            className="h-7 px-2"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Force retry
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onResetCounter}
            disabled={busy}
            className="h-7 px-2"
          >
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
};

// ─── C2: Empty-Local-Conflict resolvers ────────────────────────────────────
//
// Three actions are exposed in the diagnostics sheet:
//   • Restore from server   — pulls server children into IDB (the prior auto-
//                              behavior, now opt-in).
//   • Confirm local empty   — stamps `user_cleared_at` so the next sync deletes
//                              server rows via the normal reconcile path.
//   • Dismiss               — just removes the conflict entry.

type ChildSection = { table: string; column: string };

const SECTIONS_BY_TYPE: Record<EmptyLocalConflictEntry['reportType'], ChildSection[]> = {
  inspection: [
    { table: 'inspection_systems', column: 'inspection_id' },
    { table: 'inspection_ziplines', column: 'inspection_id' },
    { table: 'inspection_equipment', column: 'inspection_id' },
    { table: 'inspection_standards', column: 'inspection_id' },
    { table: 'inspection_summary', column: 'inspection_id' },
  ],
  training: [
    { table: 'training_delivery_approaches', column: 'training_id' },
    { table: 'training_operating_systems', column: 'training_id' },
    { table: 'training_immediate_attention', column: 'training_id' },
    { table: 'training_verifiable_items', column: 'training_id' },
    { table: 'training_systems_in_place', column: 'training_id' },
    { table: 'training_summary', column: 'training_id' },
  ],
  daily_assessment: [
    { table: 'daily_assessment_beginning_of_day', column: 'assessment_id' },
    { table: 'daily_assessment_end_of_day', column: 'assessment_id' },
    { table: 'daily_assessment_operating_systems', column: 'assessment_id' },
    { table: 'daily_assessment_equipment_checks', column: 'assessment_id' },
    { table: 'daily_assessment_structure_checks', column: 'assessment_id' },
    { table: 'daily_assessment_environment_checks', column: 'assessment_id' },
  ],
};

// inspection_systems -> 'systems', training_delivery_approaches -> 'delivery_approaches', etc.
function offlineSectionKey(reportType: EmptyLocalConflictEntry['reportType'], table: string): string {
  if (reportType === 'inspection') return table.replace(/^inspection_/, '');
  if (reportType === 'training') return table.replace(/^training_/, '');
  return table.replace(/^daily_assessment_/, '');
}

async function restoreEmptyLocalFromServer(entry: EmptyLocalConflictEntry): Promise<void> {
  const sections = SECTIONS_BY_TYPE[entry.reportType];
  // Pull each section from server in parallel.
  const fetched = await Promise.all(
    sections.map(async (s) => {
      const { data, error } = await supabase
        .from(s.table as any)
        .select('*')
        .eq(s.column, entry.id);
      if (error) throw error;
      return { section: offlineSectionKey(entry.reportType, s.table), rows: data || [] };
    }),
  );

  // Persist into the appropriate local store.
  await Promise.all(
    fetched.map(({ section, rows }) => {
      if (rows.length === 0) return Promise.resolve();
      const safeRows = rows as unknown as Record<string, unknown>[];
      if (entry.reportType === 'inspection') {
        return saveRelatedDataOffline(section as any, entry.id, safeRows);
      }
      if (entry.reportType === 'training') {
        return saveTrainingDataOffline(section as any, entry.id, safeRows);
      }
      return saveAssessmentDataOffline(section as any, entry.id, safeRows);
    }),
  );

  // Re-align parent timestamps so it stops appearing as unsynced.
  const aligned = new Date().toISOString();
  if (entry.reportType === 'inspection') {
    const parent = await getOfflineInspection(entry.id);
    if (parent) {
      await saveInspectionOffline({ ...parent, synced_at: aligned, updated_at: aligned } as any);
    }
  } else if (entry.reportType === 'training') {
    const parent = await getOfflineTraining(entry.id);
    if (parent) {
      await saveTrainingOffline({ ...parent, synced_at: aligned, updated_at: aligned } as any);
    }
  } else {
    const parent = await getOfflineDailyAssessment(entry.id);
    if (parent) {
      await saveDailyAssessmentOffline({ ...parent, synced_at: aligned, updated_at: aligned } as any);
    }
  }
}

async function confirmEmptyLocal(entry: EmptyLocalConflictEntry): Promise<void> {
  if (entry.reportType === 'inspection') {
    const parent = await getOfflineInspection(entry.id);
    if (!parent) throw new Error('Local inspection not found');
    await saveInspectionOffline(markUserCleared(parent as any) as any);
  } else if (entry.reportType === 'training') {
    const parent = await getOfflineTraining(entry.id);
    if (!parent) throw new Error('Local training not found');
    await saveTrainingOffline(markUserCleared(parent as any) as any);
  } else {
    const parent = await getOfflineDailyAssessment(entry.id);
    if (!parent) throw new Error('Local assessment not found');
    await saveDailyAssessmentOffline(markUserCleared(parent as any) as any);
  }
}

const REPORT_TYPE_LABEL: Record<EmptyLocalConflictEntry['reportType'], string> = {
  inspection: 'Inspection',
  training: 'Training',
  daily_assessment: 'Daily Assessment',
};

const EmptyLocalConflictRow = ({
  entry,
  busy,
  onRestoreFromServer,
  onConfirmLocalEmpty,
  onDismiss,
}: {
  entry: EmptyLocalConflictEntry;
  busy: boolean;
  onRestoreFromServer: () => void;
  onConfirmLocalEmpty: () => void;
  onDismiss: () => void;
}) => {
  const title =
    entry.organizationLabel?.trim() || `${REPORT_TYPE_LABEL[entry.reportType]} ${entry.id.substring(0, 8)}`;
  const sectionSummary = Object.entries(entry.serverCounts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${count} ${key}`)
    .join(', ');
  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-medium text-foreground truncate">
          {title} <span className="text-muted-foreground">— {REPORT_TYPE_LABEL[entry.reportType]}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          Server has {sectionSummary || 'data'}.
        </div>
        <div className="text-xs text-muted-foreground">
          Detected {formatDistanceToNow(new Date(entry.detectedAt), { addSuffix: true })}.
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={onRestoreFromServer}
          disabled={busy}
          className="h-7 px-2"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Restore from server
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onConfirmLocalEmpty}
          disabled={busy}
          className="h-7 px-2 text-destructive hover:text-destructive"
        >
          Confirm local empty
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          disabled={busy}
          className="h-7 px-2"
        >
          <X className="h-3 w-3 mr-1" />
          Dismiss
        </Button>
      </div>
    </div>
  );
};

interface PhotoFailureRowProps {
  entry: PhotoUploadFailureEntry;
  busy: boolean;
  onRetry: () => void | Promise<void>;
  onDismiss: () => void | Promise<void>;
}

const PhotoFailureRow = ({ entry, busy, onRetry, onDismiss }: PhotoFailureRowProps) => {
  const failedAgo = entry.lastErrorAt
    ? formatDistanceToNow(new Date(entry.lastErrorAt), { addSuffix: true })
    : '—';
  return (
    <div className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground truncate">
            {entry.section || entry.fileName || entry.id}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {entry.lastError}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {entry.retryCount} attempts · failed {failedAgo}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          disabled={busy}
          className="h-7 px-2"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Retry
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          disabled={busy}
          className="h-7 px-2"
        >
          <X className="h-3 w-3 mr-1" />
          Dismiss
        </Button>
      </div>
    </div>
  );
};
