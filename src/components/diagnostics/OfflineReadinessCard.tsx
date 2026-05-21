import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";
import {
  captureOfflineReadinessSnapshot,
  type OfflineReadinessSnapshot,
} from "@/lib/offline-readiness";
import { hasCachedSessionForOffline, getOfflineUserId } from "@/lib/cached-auth";
import { readSyntheticSession } from "@/lib/offline-auth";
import { readGuestSession } from "@/lib/guest-session";
import { hasLastKnownAccount } from "@/lib/last-known-account";
import { getShellWarmupResults } from "@/lib/shell-warmup";
import { getPrefetchResults } from "@/lib/prefetch-user-data";
import { getPhotoPrewarmResult } from "@/lib/photo-prewarm";

type Status = "ok" | "warn" | "fail";

interface Row {
  label: string;
  status: Status;
  detail?: string;
}

function StatusIcon({ status }: { status: Status }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />;
  return <XCircle className="h-4 w-4 text-destructive" aria-hidden />;
}

function isStandalonePWA(): boolean {
  try {
    return (
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (window.navigator as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/**
 * Low-noise diagnostics card showing whether the device is prepared
 * for offline use. Safe to mount anywhere; non-blocking.
 */
export function OfflineReadinessCard() {
  const [snapshot, setSnapshot] = useState<OfflineReadinessSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const synth = !!readSyntheticSession();
      const guest = !!readGuestSession();
      const snap = await captureOfflineReadinessSnapshot({
        localStorageSessionPresent: hasCachedSessionForOffline(),
        syntheticSessionPresent: synth,
        guestSessionPresent: guest,
      });
      setSnapshot(snap);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!snapshot) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground" data-testid="offline-readiness-card">
        Checking offline readiness…
      </div>
    );
  }

  const offlineAuthOk =
    snapshot.localStorageSessionPresent ||
    snapshot.syntheticSessionPresent ||
    snapshot.guestSessionPresent ||
    snapshot.lastKnownAccountPresent;

  // ──────────────────────────────────────────────────────────────────────
  // Group A — Shell & Auth (required to OPEN the app offline).
  // If any of these fail, a cold offline launch can dead-end.
  // ──────────────────────────────────────────────────────────────────────
  const shellAuthRows: Row[] = [
    {
      label: "Service worker",
      status: snapshot.swInstalled && snapshot.serviceWorkerReady ? "ok" : "warn",
      detail: snapshot.swInstalled ? (snapshot.serviceWorkerReady ? "ready" : "installed, not ready") : "not installed",
    },
    {
      label: "App shell cached",
      status: snapshot.indexHtmlCached ? "ok" : "warn",
      detail: snapshot.indexHtmlCached ? "index.html cached" : "not cached yet",
    },
    {
      label: "Offline auth",
      status: offlineAuthOk ? "ok" : "fail",
      detail: offlineAuthOk
        ? [
            snapshot.localStorageSessionPresent && "cached session",
            snapshot.syntheticSessionPresent && "synthetic",
            snapshot.guestSessionPresent && "guest",
            snapshot.lastKnownAccountPresent && "last-known account",
          ]
            .filter(Boolean)
            .join(", ")
        : "no local identity — sign in online to prepare this device",
    },
    {
      label: "Persistent storage",
      status:
        snapshot.persistentStorageGranted === true
          ? "ok"
          : "warn",
      detail:
        snapshot.persistentStorageGranted === true
          ? "granted"
          : snapshot.persistentStorageGranted === false
            ? "not granted — browser may evict data under pressure"
            : "unknown (browser does not report)",
    },
  ];

  // ──────────────────────────────────────────────────────────────────────
  // Group B — Report data & photos (required to fully WORK offline).
  // If these are warn/missing, the app still opens but cached reports
  // and photos may be incomplete until next online sync.
  // ──────────────────────────────────────────────────────────────────────
  const dataRows: Row[] = [];

  const warm = getShellWarmupResults();
  if (warm) {
    const failed = Object.entries(warm).filter(([, v]) => v === "failed");
    dataRows.push({
      label: "Core routes warmed",
      status: failed.length === 0 ? "ok" : "warn",
      detail:
        failed.length === 0
          ? `${Object.keys(warm).length} routes ready`
          : `failed: ${failed.map(([k]) => k).join(", ")}`,
    });
  } else {
    dataRows.push({
      label: "Core routes warmed",
      status: "warn",
      detail: "not warmed yet — sign in online to prepare routes",
    });
  }

  const pf = getPrefetchResults();
  if (pf) {
    dataRows.push({
      label: "Reports cached for offline",
      status: pf.failed.length === 0 ? "ok" : "warn",
      detail: `${pf.inspections} inspections · ${pf.trainings} trainings · ${pf.dailyAssessments} DAs${pf.failed.length ? ` · ${pf.failed.length} failed` : ""}`,
    });
  } else {
    dataRows.push({
      label: "Reports cached for offline",
      status: "warn",
      detail: "not prefetched yet — child rows may be missing offline",
    });
  }

  const pw = getPhotoPrewarmResult();
  if (pw && pw.attempted > 0) {
    dataRows.push({
      label: "Active-report photos warmed",
      status: pw.failed === 0 ? "ok" : "warn",
      detail: `${pw.ok}/${pw.attempted} cached${pw.skippedDueToPressure ? " (skipped: storage pressure)" : ""}`,
    });
  } else {
    dataRows.push({
      label: "Active-report photos warmed",
      status: "warn",
      detail: "no photos pre-cached yet — viewing offline may show placeholders",
    });
  }

  if (isStandalonePWA() && !offlineAuthOk) {
    shellAuthRows.push({
      label: "Installed PWA",
      status: "warn",
      detail:
        "Sign in online once inside this installed app to enable account offline access. Guest mode works without sign-in.",
    });
  }

  const allRows = [...shellAuthRows, ...dataRows];
  const shellAuthOk = shellAuthRows.every((r) => r.status === "ok");
  const anyFail = allRows.some((r) => r.status === "fail");
  const allOk = allRows.every((r) => r.status === "ok");

  const headerText = anyFail
    ? "Offline access not yet prepared on this device"
    : allOk
      ? "This device is fully ready for offline use"
      : shellAuthOk
        ? "Can open offline · report data still preparing"
        : "Offline use: some checks need attention";

  const renderGroup = (title: string, subtitle: string, rows: Row[]) => (
    <div className="space-y-1.5">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        <div className="text-[11px] text-muted-foreground">{subtitle}</div>
      </div>
      <ul className="space-y-1.5 text-sm">
        {rows.map((row) => (
          <li key={row.label} className="flex items-start gap-2">
            <StatusIcon status={row.status} />
            <div className="min-w-0">
              <div className="font-medium">{row.label}</div>
              {row.detail && (
                <div className="text-xs text-muted-foreground break-words">{row.detail}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div
      className="rounded-lg border bg-card p-4 space-y-4"
      data-testid="offline-readiness-card"
      data-overall-status={anyFail ? "fail" : allOk ? "ok" : "warn"}
      data-shell-auth-status={shellAuthOk ? "ok" : "warn"}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{headerText}</h3>
        <button
          type="button"
          onClick={refresh}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Refresh offline readiness"
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
      {renderGroup(
        "Shell & Auth",
        "Required to open the app offline",
        shellAuthRows,
      )}
      {renderGroup(
        "Report data & photos",
        "Required to view and edit your reports offline",
        dataRows,
      )}
    </div>
  );
}

export default OfflineReadinessCard;
