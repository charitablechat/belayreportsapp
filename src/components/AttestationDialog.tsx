import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import {
  buildAttestationText,
  buildAttestationPayload,
  namesMatch,
  type AttestationPayload,
  type ReportKind,
} from "@/lib/attestation";

interface AttestationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ReportKind;
  signerName: string;
  signerId: string | null;
  organization: string;
  reportDate: string;
  onSigned: (payload: AttestationPayload) => void | Promise<void>;
}

export function AttestationDialog({
  open,
  onOpenChange,
  kind,
  signerName,
  signerId,
  organization,
  reportDate,
  onSigned,
}: AttestationDialogProps) {
  const [agreed, setAgreed] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setAgreed(false);
      setTypedName("");
      setSubmitting(false);
    }
  }, [open]);

  const ctx = useMemo(
    () => ({ kind, signerName, organization, reportDate }),
    [kind, signerName, organization, reportDate],
  );

  const statement = useMemo(() => buildAttestationText(ctx), [ctx]);
  const nameValid = namesMatch(typedName, signerName);
  const canSign = agreed && nameValid && !submitting && !!signerName;

  const missingProfile = !signerName?.trim();

  const handleSign = async () => {
    if (!canSign) return;
    setSubmitting(true);
    try {
      const payload = buildAttestationPayload(ctx, signerId);
      await onSigned(payload);
      onOpenChange(false);
    } catch (err) {
      console.error("[AttestationDialog] Sign failed:", err);
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Inspector Attestation
          </DialogTitle>
          <DialogDescription>
            Electronic signature required to complete this report.
          </DialogDescription>
        </DialogHeader>

        {missingProfile ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Your profile is missing a name. Add your first and last name in your profile
              settings before completing this report.
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed text-foreground">
              {statement}
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="attestation-agree"
                checked={agreed}
                onCheckedChange={(v) => setAgreed(v === true)}
                disabled={submitting}
              />
              <Label
                htmlFor="attestation-agree"
                className="text-sm leading-snug cursor-pointer"
              >
                I have read the statement above and agree to electronically sign this
                report.
              </Label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="attestation-name">
                Type your full name to sign
                <span className="ml-2 text-xs text-muted-foreground">
                  (must match: {signerName})
                </span>
              </Label>
              <Input
                id="attestation-name"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder={signerName}
                autoComplete="off"
                disabled={submitting}
                className={
                  typedName && !nameValid
                    ? "border-destructive focus-visible:ring-destructive"
                    : ""
                }
              />
              {typedName && !nameValid && (
                <p className="text-xs text-destructive">
                  Name doesn't match your profile name.
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Your device, browser, and IP address will be recorded with this signature for
              audit purposes.
            </p>
          </>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSign} disabled={!canSign || missingProfile}>
            {submitting ? "Signing…" : "Sign & Complete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
