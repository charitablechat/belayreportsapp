import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  performRestore,
  plainEnglishFailure,
  type RestoreResult,
} from '@/lib/recovery/self-service-restore';
import type { RecoverableField } from '@/lib/recovery/training-recovery-scan';
import { FIELD_LABEL } from '@/lib/recovery/pinned-training-recoveries';

/**
 * Plain-English confirmation + result screen for Self-Service Restore.
 *
 * - Only renders the primary action when `eligible` is true.
 * - Failure text is plain English; raw detail is never shown (it is logged for
 *   developer troubleshooting inside performRestore).
 * - On non-OK results the dialog stays open with a Retry button so the user
 *   still has Copy / Send to admin / Download on the underlying finding card.
 */
export function FillMissingTextDialog({
  open,
  onOpenChange,
  reportName,
  trainingId,
  field,
  recoveredPlainText,
  scanSeenUpdatedAt,
  appVersion,
  onSuccess,
  onNeedsRescan,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  reportName: string;
  trainingId: string;
  field: RecoverableField;
  recoveredPlainText: string;
  scanSeenUpdatedAt: string | null;
  appVersion?: string;
  onSuccess: (result: Extract<RestoreResult, { ok: true }>) => void;
  onNeedsRescan: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const handleConfirm = async () => {
    setFailure(null);
    setSubmitting(true);
    try {
      const result = await performRestore({
        trainingId,
        field,
        recoveredText: recoveredPlainText,
        scanSeenUpdatedAt,
        clientMetadata: { app_version: appVersion },
      });

      if (result.ok) {
        onSuccess(result);
        onOpenChange(false);
        return;
      }

      if (result.reason === 'needs_rescan') {
        onNeedsRescan();
        onOpenChange(false);
        return;
      }

      setFailure(plainEnglishFailure(result.reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return; // prevent close while in flight
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Fill missing text?</DialogTitle>
          <DialogDescription>
            This will only fill the missing {FIELD_LABEL[field]} field on your own
            report. It will not change anything else. A backup is taken first.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div>
            <div className="text-muted-foreground">Report</div>
            <div className="font-medium">{reportName}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Field</div>
            <div className="font-medium">{FIELD_LABEL[field]}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Currently saved on server</div>
            <div className="font-medium italic">(blank)</div>
          </div>
          <div>
            <div className="text-muted-foreground">Text we will put in</div>
            <div className="border border-foreground/10 p-3 whitespace-pre-wrap font-serif max-h-56 overflow-auto">
              {recoveredPlainText || '(no readable text)'}
            </div>
          </div>

          {failure && (
            <div className="border border-destructive/40 p-3 text-destructive">
              {failure}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                Filling…
              </>
            ) : failure ? (
              'Try again'
            ) : (
              'Yes, fill this missing text'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
