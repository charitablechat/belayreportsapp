import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Copy,
  Download,
  Loader2,
  Mail,
  Wand2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useVersionStatus } from '@/hooks/useVersionStatus';
import { getUserWithCache } from '@/lib/cached-auth';
import { supabase } from '@/integrations/supabase/client';
import {
  listLocalTrainings,
  type LocalReportEntry,
} from '@/lib/recovery/local-report-index';
import {
  scanTrainingForRecoverableText,
  type RecoveryFinding,
} from '@/lib/recovery/training-recovery-scan';
import {
  PINNED_TRAINING_RECOVERIES,
  FIELD_LABEL,
} from '@/lib/recovery/pinned-training-recoveries';
import { FillMissingTextDialog } from '@/components/recovery/FillMissingTextDialog';
import {
  checkEligibility,
  type Eligibility,
} from '@/lib/recovery/self-service-restore';

/**
 * Recovery & Sync Health — permanent, read-only, per-user feature.
 *
 * Trainings-first slice. Lists the signed-in user's trainings from local
 * IndexedDB FIRST (works offline) and optionally enriches with RLS-scoped
 * server reads when online. The scanner is read-only; no writes, no deletes,
 * no cache clearing, no forced refresh, no service-worker update, no
 * restore/save button.
 */

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

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function FindingCard({
  reportName,
  finding,
}: {
  reportName: string;
  finding: RecoveryFinding;
}) {
  const plain = useMemo(() => htmlToPlainText(finding.text), [finding.text]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(plain);
      toast.success('Text copied. Paste it into a message to your admin.');
    } catch {
      toast.error('Copy failed. Long-press the text below to select it manually.');
    }
  };

  const handleEmail = () => {
    const subject = encodeURIComponent(
      `Recovered ${FIELD_LABEL[finding.field]} — ${reportName}`,
    );
    const body = encodeURIComponent(
      `Report: ${reportName}\nField: ${FIELD_LABEL[finding.field]}\nFound: ${finding.sourceLabel}${
        finding.sourceDetail ? ` (${finding.sourceDetail})` : ''
      }\nSaved: ${formatAgo(finding.timestamp)}\n\n---\n\n${plain}\n`,
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const handleDownload = () => {
    const blob = new Blob([plain], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reportName.replace(/\s+/g, '_')}_${finding.field}.txt`;
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
          {finding.sourceDetail ? ` (${finding.sourceDetail})` : ''} ·{' '}
          {formatAgo(finding.timestamp)}
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
          <Mail className="w-4 h-4 mr-1.5" /> Send to admin
        </Button>
        <Button size="sm" variant="outline" onClick={handleDownload}>
          <Download className="w-4 h-4 mr-1.5" /> Download as .txt
        </Button>
      </div>
    </div>
  );
}

function ReportRow({
  entry,
  online,
  highlighted,
}: {
  entry: LocalReportEntry;
  online: boolean;
  highlighted?: boolean;
}) {
  const [state, setState] = useState<ScanState>({ status: 'idle', findings: [] });

  const handleCheck = async () => {
    setState({ status: 'scanning', findings: [] });
    try {
      const findings = await scanTrainingForRecoverableText(entry.id);
      setState({ status: 'done', findings });
    } catch {
      setState({ status: 'done', findings: [] });
    }
  };

  const statusLine = entry.localOnly
    ? 'Saved on this device. Not confirmed on server yet.'
    : online
    ? 'Saved on this device and confirmed on server.'
    : 'Offline — based on this device only.';

  return (
    <Card className={highlighted ? 'border-foreground/40' : ''}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
          <span>{entry.displayName}</span>
          {entry.subLabel && (
            <span className="text-sm font-normal text-muted-foreground">
              — {entry.subLabel}
            </span>
          )}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
          {entry.localOnly && (
            <Badge variant="outline" className="font-normal">
              On this device only
            </Badge>
          )}
          {highlighted && (
            <Badge variant="outline" className="font-normal">
              Flagged for recovery
            </Badge>
          )}
          <span>{statusLine}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.status === 'idle' && (
          <Button onClick={handleCheck} className="w-full sm:w-auto">
            Check this report
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
              Found {state.findings.length} recoverable item
              {state.findings.length === 1 ? '' : 's'}. Copy the text or send it to your admin.
              Do not edit the report yet.
            </p>
            {state.findings.map((f, i) => (
              <FindingCard
                key={`${f.field}-${i}`}
                reportName={entry.displayName}
                finding={f}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function RecoveryAndSyncHealth() {
  const { fullName } = useUserProfile();
  const online = useOnlineStatus();
  const { installed } = useVersionStatus();

  // Resolve signed-in user id (shared-device safety).
  const { data: userId } = useQuery({
    queryKey: ['recovery-current-user-id'],
    queryFn: async () => {
      const u = await getUserWithCache();
      return u?.id ?? null;
    },
    staleTime: 60_000,
  });

  // Admin flag — only used to render the additive admin support section.
  const { data: isAdmin } = useQuery({
    queryKey: ['recovery-is-admin', userId],
    enabled: !!userId && online,
    queryFn: async () => {
      try {
        const { data } = await supabase.rpc('is_admin_or_above');
        return !!data;
      } catch {
        return false;
      }
    },
    staleTime: 5 * 60_000,
  });

  // Local trainings — always shown, works offline.
  const { data: localTrainings = [], isLoading: localLoading } = useQuery({
    queryKey: ['recovery-local-trainings', userId],
    queryFn: () => listLocalTrainings(userId ?? null),
  });

  // Optional server enrichment — only when online. Server rows enrich, never replace.
  const { data: serverTrainings = [] } = useQuery({
    queryKey: ['recovery-server-trainings', userId],
    enabled: !!userId && online,
    queryFn: async () => {
      try {
        const { data } = await supabase
          .from('trainings')
          .select('id, organization, location, start_date, status, updated_at, inspector_id')
          .order('updated_at', { ascending: false })
          .limit(200);
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    },
    staleTime: 30_000,
  });

  // Merge: local first; append server rows that aren't already represented locally.
  const reports = useMemo<LocalReportEntry[]>(() => {
    const byId = new Map<string, LocalReportEntry>();
    for (const r of localTrainings) byId.set(r.id, r);
    for (const s of serverTrainings) {
      const id = typeof s.id === 'string' ? s.id : null;
      if (!id || byId.has(id)) continue;
      // Shared-device safety: if inspector_id is present, require it to match.
      if (userId && typeof s.inspector_id === 'string' && s.inspector_id !== userId) continue;
      const displayName =
        (typeof s.organization === 'string' && s.organization) ||
        (typeof s.location === 'string' && s.location) ||
        'Untitled training';
      const date = typeof s.start_date === 'string' ? s.start_date : null;
      const status = typeof s.status === 'string' ? s.status : null;
      const updatedAt =
        typeof s.updated_at === 'string' ? Date.parse(s.updated_at) : null;
      byId.set(id, {
        kind: 'training',
        id,
        displayName,
        subLabel: [date, status].filter(Boolean).join(' · ') || 'On server',
        localOnly: false,
        updatedAt: Number.isFinite(updatedAt as number) ? (updatedAt as number) : null,
      });
    }
    return Array.from(byId.values()).sort(
      (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    );
  }, [localTrainings, serverTrainings, userId]);

  const pinnedIds = useMemo(
    () => new Set(PINNED_TRAINING_RECOVERIES.map((p) => p.trainingId)),
    [],
  );

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2">
          <Link to="/dashboard">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to dashboard
          </Link>
        </Button>
        <h1 className="text-2xl font-serif">Recovery & Sync Health</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {fullName ? `Signed in as ${fullName}.` : 'Signed in.'} This page only reads your
          device. It does not change, send, or sync anything.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          App version: {installed || 'unknown'} · Trainings supported in this release
          (inspections and daily assessments coming soon).
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-2 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            {online ? (
              <Wifi className="w-4 h-4" aria-hidden />
            ) : (
              <WifiOff className="w-4 h-4" aria-hidden />
            )}
            {online ? 'Online' : 'Offline'}
          </div>
          <p className="text-muted-foreground">
            {online
              ? 'Your device can talk to the server. The list below shows reports from this device, and any extra reports the server knows about.'
              : 'You are offline. The list below shows reports saved on this device. Server comparison is unavailable until you reconnect.'}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-3 text-sm">
          <p className="font-semibold">How to check a report</p>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>
              Open Ropeworks on the <strong>same device and browser</strong> where you originally
              typed the report.
            </li>
            <li>
              Find the report below and tap <em>Check this report</em>.
            </li>
            <li>
              If text appears, <strong>do not edit the report yet</strong>. Tap <em>Copy text</em>{' '}
              or <em>Send to admin</em>.
            </li>
            <li>Do not refresh, update, or reinstall the app until your admin confirms.</li>
          </ol>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Your trainings</h2>
        {localLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading from this device…
          </div>
        ) : reports.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm">
              <p>No trainings found on this device.</p>
              <p className="text-muted-foreground mt-1">
                If you were expecting to see a report here, open Ropeworks on the device where you
                originally typed it.
              </p>
            </CardContent>
          </Card>
        ) : (
          reports.map((r) => (
            <ReportRow
              key={r.id}
              entry={r}
              online={online}
              highlighted={pinnedIds.has(r.id)}
            />
          ))
        )}
      </div>

      {isAdmin && (
        <div className="space-y-3 pt-4 border-t border-foreground/10">
          <h2 className="text-lg font-semibold">Admin support view</h2>
          <p className="text-sm text-muted-foreground">
            Visible to admins only. Use this to guide a user through recovery on their own device.
            This view is also read-only.
          </p>
          <Card>
            <CardContent className="pt-6 space-y-2 text-sm">
              <p className="font-semibold">Reports flagged for recovery</p>
              <ul className="list-disc pl-5 space-y-1">
                {PINNED_TRAINING_RECOVERIES.map((p) => (
                  <li key={p.trainingId}>
                    {p.reportLabel} — {p.trainerName} (missing:{' '}
                    {p.missingFields.map((f) => FIELD_LABEL[f]).join(', ')})
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground pt-2">
                Ask the affected user to open this page (<em>Profile → Recovery &amp; Sync Health</em>)
                on their original device and tap <em>Check this report</em>.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
