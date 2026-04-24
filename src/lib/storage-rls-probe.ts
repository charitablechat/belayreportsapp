/**
 * Storage RLS probe.
 *
 * Verifies the photo-upload path is RLS-healthy for the current user by
 * uploading a 1-byte file to `${user.id}/__probe/${Date.now()}.bin` and
 * immediately deleting it.
 *
 * Trigger schedule (M3):
 *  - Boot: `runStorageRlsProbeOnce()` — at most once per UTC day per user
 *    (legacy behaviour, preserved so we don't regress the boot path).
 *  - Every Nth sync cycle: `maybeRunCycleProbe()` — catches mid-day RLS
 *    regressions (e.g. a Supabase migration applied at 2pm) without waiting
 *    for the UTC rollover. Uses an in-memory cycle counter, force-bypasses
 *    the daily flag, and is rate-limited so we never run two probes in the
 *    same minute regardless of trigger source.
 *  - First photo upload failure per cycle: `triggerProbeOnPhotoFailure(err)`
 *    — when an upload errors with what looks like an RLS denial we re-run
 *    the probe immediately to confirm "policy regression" vs "transient
 *    per-photo error". Same minute-level rate-limit applies.
 *
 * Failures are surfaced via the centralized error logger (audit_logs) and
 * the sync notification rail — no toasts at boot.
 */
import { supabase } from '@/integrations/supabase/client';
import { getUserWithCache } from '@/lib/cached-auth';
import { isPreviewOrIframeEnvironment } from '@/lib/environment';
import { logError } from '@/lib/log-error';
import { addSyncNotification } from '@/lib/notification-center';
import { safeSetItem } from '@/lib/safe-local-storage';

const BUCKET = 'inspection-photos';
const PROBE_TIMEOUT_MS = 10_000;
/** M3: Run a probe every Nth completed sync cycle. */
const CYCLE_PROBE_INTERVAL = 10;
/**
 * M3: Hard rate-limit — never run two probes within this window regardless of
 * trigger source. Stops boot + cycle + photo-failure triggers from stampeding
 * the storage API on a freshly-opened tab.
 */
const PROBE_MIN_INTERVAL_MS = 60_000;

let didRunBoot = false;
let cycleCount = 0;
let lastProbeAt = 0;
let probeInFlight: Promise<void> | null = null;

function todayKey(userId: string): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return `storage-rls-probe:${userId}:${ymd}`;
}

export function isRlsDenial(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const status = (err as { statusCode?: number | string })?.statusCode;
  return (
    String(status) === '403' ||
    /row-level security|policy|unauthorized|forbidden/i.test(msg)
  );
}

interface ProbeOptions {
  /**
   * Bypass the once-per-UTC-day localStorage flag. Used by the cycle and
   * photo-failure triggers — they need fresh signal, not yesterday's "ok".
   */
  force?: boolean;
  /** Trigger label for logs/audit. */
  source?: 'boot' | 'cycle' | 'photo-failure';
}

async function runStorageRlsProbe(options: ProbeOptions = {}): Promise<void> {
  const { force = false, source = 'boot' } = options;

  // Coalesce concurrent calls — every trigger awaits the same in-flight promise.
  if (probeInFlight) return probeInFlight;

  // Hard rate-limit across all trigger sources.
  const now = Date.now();
  if (now - lastProbeAt < PROBE_MIN_INTERVAL_MS) {
    if (import.meta.env.DEV) {
      console.log(`[StorageRlsProbe] Skipped (${source}) — last probe was ${Math.round((now - lastProbeAt) / 1000)}s ago`);
    }
    return;
  }

  probeInFlight = (async () => {
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (isPreviewOrIframeEnvironment()) return;

      const user = await getUserWithCache();
      if (!user?.id) return;

      const flagKey = todayKey(user.id);
      if (!force) {
        try {
          if (localStorage.getItem(flagKey)) return;
        } catch {
          /* localStorage may be unavailable — proceed with in-memory guard only */
        }
      }

      lastProbeAt = Date.now();

      const fileName = `${user.id}/__probe/${Date.now()}.bin`;
      const body = new Blob([new Uint8Array([0])], {
        type: 'application/octet-stream',
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

      let aborted = false;
      let probeFailed = false;
      let probeError: unknown = null;

      try {
        const uploadPromise = supabase.storage
          .from(BUCKET)
          .upload(fileName, body, { upsert: false });

        const result = await Promise.race([
          uploadPromise,
          new Promise<{ error: Error }>((_, reject) => {
            controller.signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('probe-timeout'));
            });
          }),
        ]).catch((err) => ({ error: err as Error }));

        if ((result as { error?: unknown })?.error) {
          probeError = (result as { error: unknown }).error;
          probeFailed = true;
        }
      } catch (err) {
        probeError = err;
        probeFailed = true;
      } finally {
        clearTimeout(timeoutId);
        // Always attempt to clean up — don't let litter pile up.
        try {
          await supabase.storage.from(BUCKET).remove([fileName]);
        } catch (cleanupErr) {
          // Cleanup failure is non-fatal; just log.
          if (import.meta.env.DEV) {
            console.warn('[StorageRlsProbe] Cleanup failed', cleanupErr);
          }
        }
      }

      if (aborted) {
        // Transient — don't set the flag, don't notify. Retry next trigger.
        if (import.meta.env.DEV) {
          console.warn(`[StorageRlsProbe] Aborted (timeout) — will retry (source=${source})`);
        }
        return;
      }

      if (probeFailed) {
        const isRls = isRlsDenial(probeError);
        console.error('[StorageRlsProbe] FAILED', {
          source,
          rls: isRls,
          error: probeError,
        });
        logError(probeError, {
          scope: 'storage-rls-probe',
          userId: user.id,
          extra: {
            rlsDenial: isRls,
            bucket: BUCKET,
            source,
          },
        });
        addSyncNotification(
          'Storage upload check failed — new photos may not save. Open Sync Diagnostics.'
        );
        // Set flag anyway: a hard RLS failure won't fix itself within the day,
        // and we don't want to spam notifications on every retrigger. The
        // force-bypass on cycle/photo-failure triggers will still re-detect
        // recovery within `PROBE_MIN_INTERVAL_MS`.
        safeSetItem(flagKey, String(Date.now()), { scope: 'storage-rls-probe.flag' });
        return;
      }

      // Success
      if (import.meta.env.DEV) {
        console.log(`[StorageRlsProbe] OK (source=${source})`);
      }
      safeSetItem(flagKey, String(Date.now()), { scope: 'storage-rls-probe.flag' });
    } catch (err) {
      // Last-resort guard: probe must never throw into boot/sync paths.
      if (import.meta.env.DEV) {
        console.warn('[StorageRlsProbe] Unexpected error', err);
      }
    } finally {
      probeInFlight = null;
    }
  })();

  return probeInFlight;
}

/**
 * Boot probe — at most once per UTC day per user (preserves Fix 1.D semantics).
 */
export async function runStorageRlsProbeOnce(): Promise<void> {
  if (didRunBoot) return;
  didRunBoot = true;
  await runStorageRlsProbe({ source: 'boot', force: false });
}

/**
 * M3: Called from the sync loop after every completed cycle. Runs a probe
 * every Nth cycle, force-bypassing the daily flag so a mid-day policy
 * regression is caught within ~10 sync cycles instead of waiting for the
 * next UTC rollover + reload.
 */
export function maybeRunCycleProbe(): void {
  cycleCount += 1;
  if (cycleCount % CYCLE_PROBE_INTERVAL !== 0) return;
  void runStorageRlsProbe({ source: 'cycle', force: true });
}

/**
 * M3: Called from the photo-upload error path when an RLS-shaped error is
 * observed. Re-runs the probe immediately (force) to disambiguate
 * "policy regression affecting all uploads" from "this one photo had a
 * transient blip". Hard rate-limit prevents stampedes during a wave of
 * failures.
 */
export function triggerProbeOnPhotoFailure(err: unknown): void {
  if (!isRlsDenial(err)) return;
  void runStorageRlsProbe({ source: 'photo-failure', force: true });
}

/** Test-only helper to reset module state between specs. */
export function __resetStorageRlsProbeForTests(): void {
  didRunBoot = false;
  cycleCount = 0;
  lastProbeAt = 0;
  probeInFlight = null;
}
