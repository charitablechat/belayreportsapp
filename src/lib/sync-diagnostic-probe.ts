/**
 * Sprint 2 I — one-shot "Why is my sync stuck?" diagnostic probe.
 *
 * Runs every gate the sync engine consults and returns a flat,
 * JSON-serializable snapshot the user can copy/paste back to support so
 * we can triage stuck-pending complaints without screenshots.
 *
 * Every step is wrapped in its own `try/catch` and assigns either a
 * value or a `{ error: <message> }` shape so a failure in one probe
 * cannot crash the whole readout. The final shape is stable across
 * builds — fields appear even when their probe fails so the support
 * receiver sees "where it failed" instead of "what's missing".
 */

import { APP_VERSION, APP_VERSION_FULL } from './attestation';
import { getUserWithCache, type CachedUser } from './cached-auth';
import {
  getDB,
  isIdbLayerBreakerOpen,
  isInPostOnlineRecoveryGrace,
  getCircuitBreakerStatus,
  getUnsyncedInspections,
  getUnsyncedTrainings,
  getUnsyncedDailyAssessments,
  getDeadLetterPhotos,
} from './offline-storage';
import { getPhotoRetryBuckets, type PhotoRetryBuckets } from './photo-retry-buckets';
import { getQuarantineSnapshot } from './sync-quarantine';
import { getSyncHaltState, type SyncHaltState } from './sync-halt-tracker';

type ProbeFailure = { error: string };
type ProbeResult<T> = T | ProbeFailure;

export interface SyncDiagnosticReport {
  /** Capture time (epoch ms). */
  timestamp: number;
  /** ISO version of the same. */
  capturedAt: string;
  app: {
    version: string;
    versionFull: string;
  };
  network: {
    navigatorOnLine: boolean | null;
  };
  auth: ProbeResult<{
    hasCachedUser: boolean;
    userId: string | null;
  }>;
  idb: ProbeResult<{
    readable: boolean;
    /** ms the open took (if readable). */
    openMs: number;
    layerBreakerOpen: boolean;
    inPostOnlineRecoveryGrace: boolean;
    /** Per-store circuit-breaker status (open + failureCount + resetIn). */
    perStoreBreakers: Record<string, { open: boolean; failureCount: number; resetIn: number | null }> | null;
  }>;
  syncEngine: {
    halt: SyncHaltState | null;
  };
  photos: ProbeResult<PhotoRetryBuckets & {
    deadLetterCount: number;
  }>;
  recordsByTable: ProbeResult<{
    inspections: number;
    trainings: number;
    dailyAssessments: number;
  }>;
  quarantine: ProbeResult<{
    /** Total number of quarantined records across all tables. */
    total: number;
  }>;
  ua: {
    userAgent: string | null;
    platform: string | null;
  };
}

function failureFromUnknown(e: unknown): ProbeFailure {
  if (e instanceof Error) return { error: e.message };
  if (typeof e === 'string') return { error: e };
  try {
    return { error: JSON.stringify(e) };
  } catch {
    return { error: 'unknown' };
  }
}

/**
 * Race a promise against a millisecond timeout. Resolves with the
 * promise's value, or rejects with a `'<label> timed out'` Error after
 * `ms` if the promise hasn't settled yet.
 */
function withTimeout<T>(label: string, p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Run the diagnostic probe. Never throws — all failures are caught and
 * surfaced as `{ error }` fields on the relevant section.
 */
export async function runSyncDiagnostic(): Promise<SyncDiagnosticReport> {
  const now = Date.now();

  const navigatorOnLine = typeof navigator !== 'undefined' ? navigator.onLine : null;
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null;
  const platform = typeof navigator !== 'undefined' ? navigator.platform : null;

  // Auth — race against a short timeout because the cached-auth path
  // can hang on a stuck Supabase fetch.
  let auth: SyncDiagnosticReport['auth'];
  try {
    const cached: CachedUser | null = await withTimeout(
      'auth.getUserWithCache',
      getUserWithCache(),
      3000,
    );
    auth = {
      hasCachedUser: !!cached,
      userId: cached?.id ?? null,
    };
  } catch (e) {
    auth = failureFromUnknown(e);
  }

  // IDB readability + breakers.
  let idb: SyncDiagnosticReport['idb'];
  try {
    const t0 = Date.now();
    await withTimeout('idb.getDB', getDB(), 3000);
    const openMs = Date.now() - t0;
    let perStoreBreakers: Record<string, { open: boolean; failureCount: number; resetIn: number | null }> | null = null;
    try {
      const status = getCircuitBreakerStatus();
      perStoreBreakers = Object.fromEntries(
        Object.entries(status.byStore ?? {}).map(([k, v]) => [
          k,
          { open: v.open, failureCount: v.failureCount, resetIn: v.resetIn },
        ]),
      );
    } catch {
      perStoreBreakers = null;
    }
    idb = {
      readable: true,
      openMs,
      layerBreakerOpen: (() => {
        try { return isIdbLayerBreakerOpen(); } catch { return false; }
      })(),
      inPostOnlineRecoveryGrace: (() => {
        try { return isInPostOnlineRecoveryGrace(); } catch { return false; }
      })(),
      perStoreBreakers,
    };
  } catch (e) {
    idb = failureFromUnknown(e);
  }

  // Sync engine halt state — synchronous read, no timeout needed.
  const halt = (() => {
    try { return getSyncHaltState(); } catch { return null; }
  })();

  // Photos — three buckets + dead letter count.
  let photos: SyncDiagnosticReport['photos'];
  try {
    const [buckets, deadLetter] = await Promise.all([
      withTimeout('photos.getPhotoRetryBuckets', getPhotoRetryBuckets(), 5000),
      withTimeout('photos.getDeadLetterPhotos', getDeadLetterPhotos(), 5000),
    ]);
    photos = {
      ...buckets,
      deadLetterCount: deadLetter.length,
    };
  } catch (e) {
    photos = failureFromUnknown(e);
  }

  // Records by table — count only, not full row data (avoid blowing up
  // diagnostic output on very large queues).
  let recordsByTable: SyncDiagnosticReport['recordsByTable'];
  try {
    const [insp, train, daily] = await Promise.all([
      withTimeout('records.inspections', getUnsyncedInspections(), 5000),
      withTimeout('records.trainings', getUnsyncedTrainings(), 5000),
      withTimeout('records.dailyAssessments', getUnsyncedDailyAssessments(), 5000),
    ]);
    recordsByTable = {
      inspections: Array.isArray(insp) ? insp.length : 0,
      trainings: Array.isArray(train) ? train.length : 0,
      dailyAssessments: Array.isArray(daily) ? daily.length : 0,
    };
  } catch (e) {
    recordsByTable = failureFromUnknown(e);
  }

  // Quarantine snapshot — synchronous (sync-quarantine state lives in
  // sessionStorage). Quarantine map is keyed by recordId only, so we
  // surface a single count rather than a per-table breakdown.
  let quarantine: SyncDiagnosticReport['quarantine'];
  try {
    const snap = getQuarantineSnapshot();
    quarantine = {
      total: Object.keys(snap).length,
    };
  } catch (e) {
    quarantine = failureFromUnknown(e);
  }

  return {
    timestamp: now,
    capturedAt: new Date(now).toISOString(),
    app: {
      version: APP_VERSION,
      versionFull: APP_VERSION_FULL,
    },
    network: {
      navigatorOnLine,
    },
    auth,
    idb,
    syncEngine: {
      halt,
    },
    photos,
    recordsByTable,
    quarantine,
    ua: {
      userAgent,
      platform,
    },
  };
}

/**
 * Format the diagnostic report as a copy-friendly multi-line string.
 * The output is JSON with 2-space indentation prefixed by a header line
 * that includes the captured-at ISO timestamp — saves the support
 * receiver a step when matching the report against an inbound email.
 */
export function formatSyncDiagnostic(report: SyncDiagnosticReport): string {
  return `=== RopeWorks sync diagnostic — ${report.capturedAt} ===\n${JSON.stringify(report, null, 2)}`;
}
