import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Copy, Download, Loader2, Mail, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useRequireAdminOrOwner } from '@/components/training-recovery/useRequireAdminOrOwner';
import {
  PINNED_TRAINING_RECOVERIES,
  FIELD_LABEL,
  type PinnedTrainingRecovery,
} from '@/lib/recovery/pinned-training-recoveries';
import {
  scanTrainingForRecoverableText,
  type RecoveryFinding,
} from '@/lib/recovery/training-recovery-scan';

interface ScanState {
  status: 'idle' | 'scanning' | 'done';
  findings: RecoveryFinding[];
}

function htmlToPlainText(html: string): string {
  if (typeof window === 'undefined') return html;
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || div.innerText || '').trim();
}

function formatAgo(ts: number | null): string {
  if (!ts) return 'time unknown';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'a moment ago';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function FindingCard({ pinned, finding }: { pinned: PinnedTrainingRecovery; finding: RecoveryFinding }) {
  const plain = useMemo(() => htmlToPlainText(finding.text), [finding.text]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(plain);
      toast.success('Text copied. Paste it into a message to your admin.');
    } catch {
      toast.error('Copy failed. Long-press the text below to select and copy it manually.');
    }
  };

  const handleEmail = () => {
    const subject = encodeURIComponent(
      `Recovered ${FIELD_LABEL[finding.field]} — ${pinned.reportLabel} (${pinned.trainerName})`,
    );
    const body = encodeURIComponent(
      `Report: ${pinned.reportLabel}\nTrainer: ${pinned.trainerName}\nField: ${FIELD_LABEL[finding.field]}\nFound: ${finding.sourceLabel}${finding.sourceDetail ? ` (${finding.sourceDetail})` : ''}\nSaved: ${formatAgo(finding.timestamp)}\n\n---\n\n${plain}\n`,
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const handleDownload = () => {
    const blob = new Blob([plain], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pinned.reportLabel.replace(/\s+/g, '_')}_${finding.field}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="border border-foreground/20 p-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">{FIELD_LABEL[finding.field]}</span>
        <span className="text-sm text-muted-foreground">
          Found in {finding.sourceLabel.toLowerCase()}
          {finding.sourceDetail ? ` (${finding.sourceDetail})` : ''} · {formatAgo(finding.timestamp)}
        </span>
      </div>
      <div className="bg-background border border-foreground/10 p-3 text-sm whitespace-pre-wrap font-serif max-h-72 overflow-auto">
        {plain || '(no readable text)'}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="default" onClick={handleCopy}>
          <Copy className="w-4 h-4 mr-1.5" /> Copy text
        </Button>
        <Button size="sm" variant="outline" onClick={handleEmail}>
          <Mail className="w-4 h-4 mr-1.5" /> Email to admin
        </Button>
        <Button size="sm" variant="outline" onClick={handleDownload}>
          <Download className="w-4 h-4 mr-1.5" /> Download as .txt
        </Button>
      </div>
    </div>
  );
}

function ReportCard({ pinned, canSee }: { pinned: PinnedTrainingRecovery; canSee: boolean }) {
  const [state, setState] = useState<ScanState>({ status: 'idle', findings: [] });

  if (!canSee) return null;

  const handleCheck = async () => {
    setState({ status: 'scanning', findings: [] });
    try {
      const findings = await scanTrainingForRecoverableText(
        pinned.trainingId,
        pinned.missingFields,
      );
      setState({ status: 'done', findings });
    } catch {
      setState({ status: 'done', findings: [] });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span>{pinned.reportLabel}</span>
          <span className="text-sm font-normal text-muted-foreground">— {pinned.trainerName}</span>
        </CardTitle>
        <div className="flex flex-wrap gap-1 pt-1">
          <span className="text-xs text-muted-foreground">Missing:</span>
          {pinned.missingFields.map((f) => (
            <Badge key={f} variant="outline" className="font-normal">
              {FIELD_LABEL[f]}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.status === 'idle' && (
          <Button onClick={handleCheck} className="w-full sm:w-auto">
            Check This Device for Recoverable Text
          </Button>
        )}
        {state.status === 'scanning' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking this device… (no changes are being made)
          </div>
        )}
        {state.status === 'done' && state.findings.length === 0 && (
          <div className="border border-foreground/20 p-4 text-sm">
            <p>No recoverable text was found on this device or browser.</p>
            <p className="text-muted-foreground mt-1">
              Please try the exact device and app/browser where this report was originally typed.
            </p>
            <div className="mt-3">
              <Button size="sm" variant="ghost" onClick={handleCheck}>
                Check again
              </Button>
            </div>
          </div>
        )}
        {state.status === 'done' && state.findings.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Found {state.findings.length} recoverable item{state.findings.length === 1 ? '' : 's'}.
              Copy the text or send it to your admin. Do not edit the report yet.
            </p>
            {state.findings.map((f, i) => (
              <FindingCard key={`${f.field}-${i}`} pinned={pinned} finding={f} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function TrainingRecovery() {
  const access = useRequireAdminOrOwner(PINNED_TRAINING_RECOVERIES.map((p) => p.trainingId));
  const { fullName } = useUserProfile();

  if (access.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (access.status === 'denied') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5" /> Not available
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              This recovery page is only available to admins and to the trainers whose reports are
              affected.
            </p>
            <Button asChild variant="outline">
              <Link to="/dashboard">Back to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const visiblePinned = PINNED_TRAINING_RECOVERIES.filter((p) =>
    access.isAdmin ? true : access.ownedTrainingIds.has(p.trainingId),
  );

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2">
          <Link to="/dashboard">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to dashboard
          </Link>
        </Button>
        <h1 className="text-2xl font-serif">Training Text Recovery</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {access.isAdmin
            ? 'Signed in as admin. You can see all three affected reports below.'
            : `Signed in as ${fullName || 'you'}. You can see your own affected reports below.`}
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3 text-sm">
          <p className="font-semibold">How to recover missing text</p>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>
              Open Belay Reports on the <strong>exact same iPad, phone, or computer</strong> where you
              originally typed the report. Use the same app or browser you used that day.
            </li>
            <li>
              Find your report below and tap{' '}
              <em>Check This Device for Recoverable Text</em>.
            </li>
            <li>
              If text appears, <strong>do not edit it</strong>. Tap <em>Copy text</em> or{' '}
              <em>Email to admin</em> and send it to your admin.
            </li>
            <li>
              If nothing appears, try the other device or browser you may have used that day.
            </li>
            <li>
              Do not refresh, update, or reinstall the app until your admin confirms they have the
              text.
            </li>
          </ol>
          <p className="text-muted-foreground">
            This page only reads your device. It does not change, send, or sync anything.
          </p>
        </CardContent>
      </Card>

      {visiblePinned.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm">
            <p>There are no affected reports tied to your account.</p>
          </CardContent>
        </Card>
      ) : (
        visiblePinned.map((p) => (
          <ReportCard key={p.trainingId} pinned={p} canSee />
        ))
      )}
    </div>
  );
}
