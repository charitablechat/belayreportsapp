import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Activity, RefreshCw, Trash2, X } from 'lucide-react';
import { usePWA } from '@/hooks/usePWA';
import { ForceSyncButton } from '@/components/pwa/ForceSyncButton';
import { getMobileCapabilities, checkStorageQuota } from '@/lib/mobile-detection';
import { isServiceWorkerAllowed } from '@/lib/environment';
import { getRecentTripwireBlockCount } from '@/lib/child-row-deletion-tripwire';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useUnsyncedPhotos, type DeadLetterPhotoInfo } from '@/hooks/useUnsyncedPhotos';
import {
  resetPhotoForRetry,
  deleteOfflinePhoto,
  getDeadLetterSoftDeletes,
  removeDeadLetterSoftDelete,
  type DeadLetterSoftDelete,
} from '@/lib/offline-storage';
import { retryDeadLetterSoftDelete } from '@/lib/queued-soft-delete-processor';

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
  const { deadLetterPhotos, updatePhotoCount } = useUnsyncedPhotos();
  const [open, setOpen] = useState(false);
  const [busyPhotoId, setBusyPhotoId] = useState<string | null>(null);
  const [deadLetterDeletes, setDeadLetterDeletes] = useState<DeadLetterSoftDelete[]>([]);
  const [busyDeadLetterId, setBusyDeadLetterId] = useState<string | null>(null);
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
    if (open) void refresh();
  }, [open]);

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
