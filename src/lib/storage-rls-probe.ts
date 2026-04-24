/**
 * Fix 1.D — One-time storage RLS probe.
 *
 * Verifies the photo-upload path is RLS-healthy for the current user by
 * uploading a 1-byte file to `${user.id}/__probe/${Date.now()}.bin` and
 * immediately deleting it. Runs at most once per user per UTC day.
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

let didRun = false;

function todayKey(userId: string): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return `storage-rls-probe:${userId}:${ymd}`;
}

function isRlsDenial(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const status = (err as { statusCode?: number | string })?.statusCode;
  return (
    String(status) === '403' ||
    /row-level security|policy|unauthorized|forbidden/i.test(msg)
  );
}

export async function runStorageRlsProbeOnce(): Promise<void> {
  if (didRun) return;
  didRun = true;

  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (isPreviewOrIframeEnvironment()) return;

    const user = await getUserWithCache();
    if (!user?.id) return;

    const flagKey = todayKey(user.id);
    try {
      if (localStorage.getItem(flagKey)) return;
    } catch {
      /* localStorage may be unavailable — proceed with in-memory guard only */
    }

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
      // Transient — don't set the flag, don't notify. Retry next boot.
      if (import.meta.env.DEV) {
        console.warn('[StorageRlsProbe] Aborted (timeout) — will retry');
      }
      return;
    }

    if (probeFailed) {
      const isRls = isRlsDenial(probeError);
      console.error('[StorageRlsProbe] FAILED', {
        rls: isRls,
        error: probeError,
      });
      logError(probeError, {
        scope: 'storage-rls-probe',
        userId: user.id,
        extra: {
          rlsDenial: isRls,
          bucket: BUCKET,
        },
      });
      addSyncNotification(
        'Storage upload check failed — new photos may not save. Open Sync Diagnostics.'
      );
      // Set flag anyway: a hard RLS failure won't fix itself within the day,
      // and we don't want to spam notifications on every reload.
      safeSetItem(flagKey, String(Date.now()), { scope: 'storage-rls-probe.flag' });
      return;
    }

    // Success
    if (import.meta.env.DEV) {
      console.log('[StorageRlsProbe] OK');
    }
    safeSetItem(flagKey, String(Date.now()), { scope: 'storage-rls-probe.flag' });
  } catch (err) {
    // Last-resort guard: probe must never throw into boot path.
    if (import.meta.env.DEV) {
      console.warn('[StorageRlsProbe] Unexpected error', err);
    }
  }
}
