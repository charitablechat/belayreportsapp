/**
 * Slice 5B — Restore confirmation dialog.
 *
 * Variant-driven user-facing prompt rendered before any IDB write.
 * Reads role status as an explicit prop (do not call useRequireAdmin here
 * — that hook redirects). Cancel always resolves the parent's promise
 * with `confirmed: false`. The non-admin "locked" path renders a hard
 * block with a single acknowledgement button and resolves
 * `confirmed: false`.
 *
 * Wording avoids dev-tool language and never includes report ids, child
 * row contents, photo urls, or any other sensitive fields.
 */

import { useRef } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { RestoreGateConfirmVariant } from '@/lib/recovery/restore-gate';

export interface RestoreConfirmDialogProps {
  open: boolean;
  variant: RestoreGateConfirmVariant;
  /** Whether the user is permitted to proceed for this variant. */
  canProceed: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

interface VariantCopy {
  title: string;
  body: string;
  confirmLabel: string;
}

const CONFIRM_COPY: Record<RestoreGateConfirmVariant, VariantCopy> = {
  confirm_normal: {
    title: 'Restore this backup?',
    body: 'This will replace the current local version of the report with the contents of the selected backup.',
    confirmLabel: 'Restore',
  },
  confirm_stale: {
    title: 'This backup may not be the most recent version',
    body: "This backup looks older than what's currently on this device, or its date couldn't be confirmed. Restoring will replace any newer work with the contents of the backup.",
    confirmLabel: 'Restore anyway',
  },
  confirm_locked: {
    title: 'This report is marked complete',
    body: 'Restoring will reopen this completed report for editing and replace its current contents with the backup.',
    confirmLabel: 'Reopen and restore',
  },
  confirm_stale_and_locked: {
    title: 'This report is complete and the backup may be older',
    body: "This report is marked complete, AND the backup looks older than what's on this device. Restoring will reopen the report and replace any newer work with the backup contents.",
    confirmLabel: 'Reopen and restore',
  },
};

const HARD_BLOCK_COPY: VariantCopy = {
  title: 'Only an admin can restore over a completed report',
  body: 'This report is marked complete and cannot be restored over by a regular user. Ask an administrator to perform this restore if it is needed.',
  confirmLabel: 'OK',
};

export function RestoreConfirmDialog({
  open,
  variant,
  canProceed,
  onConfirm,
  onCancel,
}: RestoreConfirmDialogProps) {
  const copy = canProceed ? CONFIRM_COPY[variant] : HARD_BLOCK_COPY;
  // De-dupe: Radix's AlertDialogAction/Cancel auto-closes the dialog and
  // triggers onOpenChange(false). Without this flag the parent's onCancel
  // would fire twice (once from the explicit onClick, once from the
  // open-state transition).
  const decided = useRef(false);
  const decide = (fn: () => void) => {
    if (decided.current) return;
    decided.current = true;
    fn();
  };
  const handleOpenChange = (next: boolean) => {
    if (!next) decide(onCancel);
  };
  // Reset decided flag when the dialog re-opens.
  if (open && decided.current) {
    decided.current = false;
  }
  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent data-testid="restore-confirm-dialog" data-variant={variant} data-can-proceed={canProceed}>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {canProceed ? (
            <>
              <AlertDialogCancel onClick={() => decide(onCancel)}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => decide(onConfirm)} data-testid="restore-confirm-proceed">
                {copy.confirmLabel}
              </AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction onClick={() => decide(onCancel)} data-testid="restore-confirm-ack">
              {copy.confirmLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
