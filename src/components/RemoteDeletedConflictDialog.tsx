import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useRemoteDeletedConflicts } from '@/hooks/useRemoteDeletedConflicts';
import {
  discardQuarantinedRecord,
  restoreQuarantinedAsNew,
  type QuarantinedRecord,
} from '@/lib/offline-storage';

/**
 * C9: Dialog surfaced when the sync detects the server-side report has
 * been soft-deleted by an admin while the local device still had unsynced
 * edits. The user picks per-record:
 *   • Restore as New — clones the local data into a brand-new report
 *     that the next sync will upload as a fresh row on the server.
 *   • Discard Local — performs the original hard-delete (no recovery).
 *
 * Records remain in IDB (hidden from dashboards) until resolved here.
 */
function describeRecord(c: QuarantinedRecord): string {
  const tableLabel =
    c.table === 'inspections'
      ? 'Inspection'
      : c.table === 'trainings'
        ? 'Training'
        : 'Daily Assessment';
  const where = [c.organization, c.location, c.site].filter(Boolean).join(' — ');
  return where ? `${tableLabel}: ${where}` : `${tableLabel} ${c.id.substring(0, 8)}`;
}

export function RemoteDeletedConflictDialog() {
  const { conflicts, refresh } = useRemoteDeletedConflicts();
  const [busyId, setBusyId] = useState<string | null>(null);

  const open = conflicts.length > 0;
  const current = useMemo(() => conflicts[0] ?? null, [conflicts]);

  if (!open || !current) return null;

  const handleRestore = async () => {
    setBusyId(current.id);
    try {
      const newId = await restoreQuarantinedAsNew(current.table, current.id);
      if (newId) {
        toast.success('Local copy restored as a new report — it will sync shortly.');
      } else {
        toast.error('Could not restore — the local record was no longer available.');
      }
      await refresh();
    } catch (err) {
      console.error('[RemoteDeletedConflictDialog] restore failed', err);
      toast.error('Failed to restore local copy.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDiscard = async () => {
    setBusyId(current.id);
    try {
      await discardQuarantinedRecord(current.table, current.id);
      toast.message('Local copy discarded.');
      await refresh();
    } catch (err) {
      console.error('[RemoteDeletedConflictDialog] discard failed', err);
      toast.error('Failed to discard local copy.');
    } finally {
      setBusyId(null);
    }
  };

  const remainder = conflicts.length - 1;

  return (
    <Dialog open={open} onOpenChange={() => { /* modal: only resolved via actions */ }}>
      <DialogContent hideDefaultClose className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
            <DialogTitle>Report deleted by admin</DialogTitle>
          </div>
          <DialogDescription>
            This report was deleted on the server while you had unsynced changes on this
            device. Your local edits are safe — choose how to proceed.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/50 p-3 space-y-2">
          <div className="text-sm font-medium">{describeRecord(current)}</div>
          <div className="text-xs text-muted-foreground">
            Deleted on server: {new Date(current.remoteDeletedAt).toLocaleString()}
          </div>
          {remainder > 0 && (
            <Badge variant="secondary" className="mt-1">
              {remainder} more pending
            </Badge>
          )}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            onClick={handleDiscard}
            disabled={busyId === current.id}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Discard local
          </Button>
          <Button
            onClick={handleRestore}
            disabled={busyId === current.id}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Restore as new
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
