import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface CompletionLockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function CompletionLockDialog({ open, onOpenChange, onConfirm }: CompletionLockDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Report Locked</AlertDialogTitle>
          <AlertDialogDescription>
            This report has been completed. Do you want to proceed with new edits?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>No</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Yes, Edit</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface CompletionLockOverlayProps {
  isLocked: boolean;
  onAttemptEdit: () => void;
  children: React.ReactNode;
}

export function CompletionLockOverlay({ isLocked, onAttemptEdit, children }: CompletionLockOverlayProps) {
  if (!isLocked) return <>{children}</>;

  return (
    <div className="relative">
      {children}
      <div
        className="absolute inset-0 z-10 cursor-pointer"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onAttemptEdit();
        }}
        aria-label="Report is locked. Click to unlock."
      />
    </div>
  );
}
