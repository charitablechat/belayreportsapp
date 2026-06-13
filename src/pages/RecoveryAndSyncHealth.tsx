import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Copy,
  Download,
  Loader2,
  Mail,
  Search,
  Wand2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useVersionStatus } from '@/hooks/useVersionStatus';
import { getUserWithCache } from '@/lib/cached-auth';
import { supabase } from '@/integrations/supabase/client';
import {
  listLocalTrainingsWithStatus,
  type LocalReportEntry,
  type LocalTrainingsResult,
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
  trainingId,
  scanSeenUpdatedAt,
  finding,
  appVersion,
  onRescanRequested,
  onFilled,
}: {
  reportName: string;
  trainingId: string;
  scanSeenUpdatedAt: string | null;
  finding: RecoveryFinding;
  appVersion?: string;
  onRescanRequested: () => void;
  onFilled: () => void;
}) {
  const plain = useMemo(() => htmlToPlainText(finding.text), [finding.text]);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [eligLoading, setEligLoading] = useState<boolean>(false);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [hidden, setHidden] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    setEligLoading(true);
    checkEligibility({
      trainingId,
      field: finding.field,
      recoveredText: finding.text,
    })
      .then((r) => {
        if (!cancelled) setEligibility(r);
      })
      .finally(() => {
        if (!cancelled) setEligLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [trainingId, finding.field, finding.text]);

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

  if (hidden) return null;

  const canFill = eligibility?.eligible === true;

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
        {canFill && (
          <Button
            size="sm"
            variant="default"
            onClick={() => setDialogOpen(true)}
          >
            <Wand2 className="w-4 h-4 mr-1.5" /> Fill Missing Text
          </Button>
        )}
        <Button size="sm" variant={canFill ? 'outline' : 'default'} onClick={handleCopy}>
          <Copy className="w-4 h-4 mr-1.5" /> Copy text
        </Button>
        <Button size="sm" variant="outline" onClick={handleEmail}>
          <Mail className="w-4 h-4 mr-1.5" /> Send to admin
        </Button>
        <Button size="sm" variant="outline" onClick={handleDownload}>
          <Download className="w-4 h-4 mr-1.5" /> Download as .txt
        </Button>
      </div>
      {!canFill && !eligLoading && eligibility && (
        <p className="text-xs text-muted-foreground">
          {eligibility.reason === 'offline'
            ? "You're offline. Reconnect to fill this field directly. Your recovered text is still here."
            : eligibility.reason === 'field_populated'
            ? 'This field already has saved text — direct fill is disabled to protect it.'
            : eligibility.reason === 'not_owner'
            ? 'Direct fill is only available on your own reports. Use Copy or Send to admin.'
            : null}
        </p>
      )}
      {canFill && (
        <FillMissingTextDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          reportName={reportName}
          trainingId={trainingId}
          field={finding.field}
          recoveredPlainText={plain}
          scanSeenUpdatedAt={scanSeenUpdatedAt}
          appVersion={appVersion}
          onSuccess={() => {
            toast.success(
              `${FIELD_LABEL[finding.field]} were filled in. Open the report to confirm.`,
            );
            setHidden(true);
            onFilled();
          }}
          onNeedsRescan={() => {
            toast.message(
              'This report changed since the last check. Please tap Check this report again.',
            );
            onRescanRequested();
          }}
        />
      )}
    </div>
  );
}

function ReportRow({
  entry,
  online,
  highlighted,
  appVersion,
}: {
  entry: LocalReportEntry;
  online: boolean;
  highlighted?: boolean;
  appVersion?: string;
}) {
  const [state, setState] = useState<ScanState>({ status: 'idle', findings: [] });
  const [scanSeenUpdatedAt, setScanSeenUpdatedAt] = useState<string | null>(null);

  const handleCheck = async () => {
    setState({ status: 'scanning', findings: [] });
    // Capture the parent training's server updated_at AT scan time so the
    // atomic DB function can detect concurrent edits between scan and fill.
    let serverUpdatedAt: string | null = null;
    if (typeof navigator === 'undefined' || navigator.onLine) {
      try {
        const { data } = await supabase
          .from('trainings')
          .select('updated_at')
          .eq('id', entry.id)
          .maybeSingle();
        serverUpdatedAt = (data?.updated_at as string | null) ?? null;
      } catch {
        serverUpdatedAt = null;
      }
    }
    setScanSeenUpdatedAt(serverUpdatedAt);
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
          {entry.trainerName && (
            <Badge variant="outline" className="font-normal">
              Trainer: {entry.trainerName}
            </Badge>
          )}
          {entry.localOnly && (
            <Badge variant="outline" className="font-normal">
              On this device only
            </Badge>
          )}
          {entry.fromBackupOnly && (
            <Badge variant="outline" className="font-normal">
              Local backup only
            </Badge>
          )}
          {!entry.localOnly && !entry.fromBackupOnly && (
            <Badge variant="outline" className="font-normal">
              On server
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
                trainingId={entry.id}
                scanSeenUpdatedAt={scanSeenUpdatedAt}
                finding={f}
                appVersion={appVersion}
                onRescanRequested={handleCheck}
                onFilled={handleCheck}
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

  // Local trainings — always shown, works offline. Status-bearing so the
  // page can distinguish "really empty" from "IDB unreadable" from "partial
  // (one bad row skipped)". Backup-envelope discovery runs even when IDB
  // times out, so locally recoverable backups still appear.
  const {
    data: localResult,
    isLoading: localLoading,
  } = useQuery<LocalTrainingsResult>({
    queryKey: ['recovery-local-trainings-v2', userId],
    queryFn: () => listLocalTrainingsWithStatus(userId ?? null),
    retry: 1,
    staleTime: 30_000,
  });
  const localTrainings: LocalReportEntry[] = localResult?.entries ?? [];
  const idbUnavailable = !!localResult?.idbUnavailable;
  const localPartial = !!localResult?.partial;

  // UI-side wall-clock fallback so a stuck loader cannot leave the user on
  // an indefinite spinner. After 4s we render whatever has been discovered
  // so far (or a degraded "taking longer than expected" notice).
  const [uiFallback, setUiFallback] = useState<boolean>(false);
  useEffect(() => {
    if (!localLoading) {
      setUiFallback(false);
      return;
    }
    const t = setTimeout(() => setUiFallback(true), 4000);
    return () => clearTimeout(t);
  }, [localLoading]);

  // Optional server enrichment — only when online. Server rows enrich, never replace.
  // Hard time-cap so a hanging request cannot bottleneck the page.
  const [serverEnrichmentFailed, setServerEnrichmentFailed] = useState<boolean>(false);
  const { data: serverTrainings = [] } = useQuery({
    queryKey: ['recovery-server-trainings', userId],
    enabled: !!userId && online,
    queryFn: async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const call = supabase
          .from('trainings')
          .select(
            'id, organization, location, start_date, status, updated_at, inspector_id, trainer_of_record',
          )
          .order('updated_at', { ascending: false })
          .limit(200)
          .abortSignal(controller.signal);
        const timeoutPromise = new Promise<'__timeout__'>((resolve) => {
          setTimeout(() => resolve('__timeout__'), 5000);
        });
        const raced = await Promise.race([call, timeoutPromise]);
        if (raced === '__timeout__') {
          setServerEnrichmentFailed(true);
          return [] as Array<Record<string, unknown>>;
        }
        const { data, error } = raced as Awaited<typeof call>;
        if (error) {
          setServerEnrichmentFailed(true);
          return [] as Array<Record<string, unknown>>;
        }
        setServerEnrichmentFailed(false);
        return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
      } catch {
        setServerEnrichmentFailed(true);
        return [] as Array<Record<string, unknown>>;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    staleTime: 30_000,
    retry: 0,
  });

  // Optional profile enrichment — batched lookup for inspector display names.
  const profileIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of serverTrainings) {
      if (typeof s.inspector_id === 'string' && s.inspector_id) ids.add(s.inspector_id);
    }
    return Array.from(ids).sort();
  }, [serverTrainings]);

  const { data: profileMap } = useQuery({
    queryKey: ['recovery-profile-names', profileIds.join('|')],
    enabled: online && profileIds.length > 0,
    queryFn: async () => {
      const map = new Map<string, string>();
      try {
        const { data } = await supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', profileIds);
        if (Array.isArray(data)) {
          for (const p of data as Array<Record<string, unknown>>) {
            const uid = typeof p.id === 'string' ? p.id : null;
            if (!uid) continue;
            const name = `${typeof p.first_name === 'string' ? p.first_name : ''} ${
              typeof p.last_name === 'string' ? p.last_name : ''
            }`.trim();
            if (name) map.set(uid, name);
          }
        }
      } catch {
        // soft-fail — map stays empty
      }
      return map;
    },
    staleTime: 5 * 60_000,
  });

  const pinnedIds = useMemo(
    () => new Set(PINNED_TRAINING_RECOVERIES.map((p) => p.trainingId)),
    [],
  );

  // Merge: local first; append server rows that aren't already represented locally.
  const reports = useMemo<LocalReportEntry[]>(() => {
    const byId = new Map<string, LocalReportEntry>();
    for (const r of localTrainings) byId.set(r.id, { ...r });
    for (const s of serverTrainings) {
      const id = typeof s.id === 'string' ? s.id : null;
      if (!id) continue;
      if (userId && typeof s.inspector_id === 'string' && s.inspector_id !== userId) continue;
      const trainerFromProfile =
        (typeof s.inspector_id === 'string' && profileMap?.get(s.inspector_id)) || null;
      const trainerFromColumn =
        typeof s.trainer_of_record === 'string' && s.trainer_of_record.trim()
          ? s.trainer_of_record.trim()
          : null;
      const trainerName = trainerFromProfile || trainerFromColumn || null;

      const existing = byId.get(id);
      if (existing) {
        if (!existing.trainerName && trainerName) existing.trainerName = trainerName;
        if (existing.fromBackupOnly) {
          existing.fromBackupOnly = false;
          existing.localOnly = false;
        }
        continue;
      }

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
        trainerName,
        startDate: date,
        status,
        fromBackupOnly: false,
      });
    }

    // Sort: pinned first, then newest updated_at.
    return Array.from(byId.values()).sort((a, b) => {
      const ap = pinnedIds.has(a.id) ? 1 : 0;
      const bp = pinnedIds.has(b.id) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
  }, [localTrainings, serverTrainings, userId, profileMap, pinnedIds]);

  const [query, setQuery] = useState('');
  const filteredReports = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) => {
      const hay = [
        r.displayName,
        r.subLabel,
        r.trainerName ?? '',
        r.startDate ?? '',
        r.status ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [reports, query]);

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
              Open Belay Reports on the <strong>same device and browser</strong> where you originally
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
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Your trainings</h2>
          {reports.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {filteredReports.length} of {reports.length} shown
            </span>
          )}
        </div>
        {reports.length > 0 && (
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by camp, trainer, or date"
              className="pl-8"
              aria-label="Search your trainings"
            />
          </div>
        )}
        {serverEnrichmentFailed && online && (
          <div className="border border-foreground/20 p-3 text-sm text-muted-foreground">
            We could not check server status right now, but local reports from this device are still shown.
          </div>
        )}
        {idbUnavailable && !localLoading && (
          <Card>
            <CardContent className="pt-6 text-sm space-y-2">
              <p className="font-semibold">We could not read reports stored on this device.</p>
              <p>Do not clear browser data or reinstall the app. Contact an admin.</p>
              {reports.length > 0 && (
                <p className="text-muted-foreground">
                  We found {reports.length} report{reports.length === 1 ? '' : 's'} in local
                  backups and have listed {reports.length === 1 ? 'it' : 'them'} below.
                </p>
              )}
            </CardContent>
          </Card>
        )}
        {localPartial && !idbUnavailable && !localLoading && reports.length > 0 && (
          <div className="border border-foreground/20 p-3 text-sm text-muted-foreground">
            Some records on this device could not be read and were skipped. The rest are shown below.
          </div>
        )}
        {localLoading && !uiFallback ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading from this device…
          </div>
        ) : localLoading && uiFallback ? (
          <Card>
            <CardContent className="pt-6 text-sm space-y-2">
              <p className="font-semibold">
                This device is taking longer than expected to read stored reports.
              </p>
              <p>
                We are showing anything we can find. Do not clear browser data or reinstall the app.
              </p>
              {reports.length > 0 ? (
                <p className="text-muted-foreground">
                  {reports.length} report{reports.length === 1 ? '' : 's'} found so far and listed
                  below.
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Nothing has surfaced from this device yet. You can wait, or come back later.
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
        {!localLoading && reports.length === 0 && !idbUnavailable ? (
          <Card>
            <CardContent className="pt-6 text-sm">
              <p>No training reports were found on this device for this signed-in user.</p>
              <p className="text-muted-foreground mt-1">
                If you were expecting to see a report here, open Belay Reports on the device where you
                originally typed it.
              </p>
            </CardContent>
          </Card>
        ) : !localLoading && reports.length > 0 && filteredReports.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No trainings match “{query}”. Clear the search to see all your reports.
            </CardContent>
          </Card>
        ) : reports.length > 0 ? (
          filteredReports.map((r) => (
            <ReportRow
              key={r.id}
              entry={r}
              online={online}
              highlighted={pinnedIds.has(r.id)}
              appVersion={installed ?? undefined}
            />
          ))
        ) : null}
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
