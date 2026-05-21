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

  const rows: Row[] = [
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
          : snapshot.persistentStorageGranted === false
            ? "warn"
            : "warn",
      detail:
        snapshot.persistentStorageGranted === true
          ? "granted"
          : snapshot.persistentStorageGranted === false
            ? "not granted — browser may evict data under pressure"
            : "unknown (browser does not report)",
    },
  ];

  // Shell warm-up results
  const warm = getShellWarmupResults();
  if (warm) {
    const failed = Object.entries(warm).filter(([, v]) => v === "failed");
    rows.push({
      label: "Core routes warmed",
      status: failed.length === 0 ? "ok" : "warn",
      detail:
        failed.length === 0
          ? `${Object.keys(warm).length} routes ready`
          : `failed: ${failed.map(([k]) => k).join(", ")}`,
    });
  }

  // Data pre-warm
  const pf = getPrefetchResults();
  if (pf) {
    rows.push({
      label: "Reports cached",
      status: pf.failed.length === 0 ? "ok" : "warn",
      detail: `${pf.inspections} inspections · ${pf.trainings} trainings · ${pf.dailyAssessments} DAs`,
    });
  }

  // Photo pre-warm
  const pw = getPhotoPrewarmResult();
  if (pw && pw.attempted > 0) {
    rows.push({
      label: "Active-report photos warmed",
      status: pw.failed === 0 ? "ok" : "warn",
      detail: `${pw.ok}/${pw.attempted} cached${pw.skippedDueToPressure ? " (skipped: storage pressure)" : ""}`,
    });
  }

  // Installed PWA without offline auth — special hint
  if (isStandalonePWA() && !offlineAuthOk) {
    rows.push({
      label: "Installed PWA",
      status: "warn",
      detail:
        "Sign in online once inside this installed app to enable account offline access. Guest mode works without sign-in.",
    });
  }

  const allOk = rows.every((r) => r.status === "ok");
  const anyFail = rows.some((r) => r.status === "fail");

  return (
    <div
      className="rounded-lg border bg-card p-4 space-y-3"
      data-testid="offline-readiness-card"
      data-overall-status={anyFail ? "fail" : allOk ? "ok" : "warn"}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {allOk
            ? "This device is ready for offline use"
            : anyFail
              ? "Offline access not yet prepared on this device"
              : "Offline use: some checks need attention"}
        </h3>
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
}

export default OfflineReadinessCard;
