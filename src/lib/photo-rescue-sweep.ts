/**
 * One-Time Photo Rescue Sweep (v1)
 *
 * After the photo-sync hardening pass (BLOCKED bucket, transient-loop cap,
 * 24h escalation, finally-block flush), photos that were dead-lettered or
 * long-stuck *before* the fix would otherwise sit on-device forever. This
 * sweep gives every eligible local photo exactly one fresh attempt under
 * the new logic.
 *
 * Eligibility (all must hold):
 *   1. uploaded === 0
 *   2. blob present (non-null, size > 0) — evicted blobs are unrecoverable
 *   3. EITHER retryCount >= MAX_PHOTO_RETRIES  (dead-letter)
 *      OR     "stuck" pattern: retryCount=0, nextRetryAt=null,
 *             lastError=null, age > STUCK_AGE_MS (24h)
 *   4. capturedByUserId matches current user OR is null/undefined (legacy)
 *   5. No prior `rescuedAt` stamp (idempotent per-photo)
 *
 * For each rescued photo we reset retryCount / nextRetryAt / lastError /
 * lastErrorAt / transientCount and stamp rescuedAt = Date.now(). The
 * matching IDB-side photo_upload_failures row (if any) is also removed.
 *
 * Auto-runs once per device, gated by localStorage[STORAGE_KEY]. The Sync
 * Diagnostics sheet exposes a "Re-run rescue sweep" button that clears the
 * marker and re-invokes the sweep for support cases.
 */

import { getDB, MAX_PHOTO_RETRIES, removePhotoUploadFailure } from '@/lib/offline-storage';
import { addSyncNotification } from '@/lib/notification-center';
import { syncLog } from '@/lib/sync-logger';

export const RESCUE_SWEEP_STORAGE_KEY = 'photo-rescue-sweep-v1-completed';

/** Photos older than this with the "0,0,null" pattern are considered stuck. */
const STUCK_AGE_MS = 24 * 60 * 60 * 1000;

export interface RescueSweepResult {
  rescued: number;
  skippedNoBlob: number;
  skippedOtherUser: number;
  skippedAlreadyRescued: number;
  scanned: number;
}

const EMPTY: RescueSweepResult = {
  rescued: 0,
  skippedNoBlob: 0,
  skippedOtherUser: 0,
  skippedAlreadyRescued: 0,
  scanned: 0,
};

function hasCompleted(): boolean {
  try {
    return Boolean(localStorage.getItem(RESCUE_SWEEP_STORAGE_KEY));
  } catch {
    return false;
  }
}

function markCompleted(): void {
  try {
    localStorage.setItem(RESCUE_SWEEP_STORAGE_KEY, new Date().toISOString());
  } catch {
    // localStorage unavailable — sweep will simply re-run next boot. Acceptable.
  }
}

export function clearRescueSweepMarker(): void {
  try {
    localStorage.removeItem(RESCUE_SWEEP_STORAGE_KEY);
  } catch {
    /* noop */
  }
}

export function getRescueSweepLastRun(): string | null {
  try {
    return localStorage.getItem(RESCUE_SWEEP_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Pure eligibility predicate (exposed for unit testing).
 */
export function isRescueEligible(
  photo: {
    uploaded?: number;
    blob?: Blob | null;
    retryCount?: number;
    nextRetryAt?: number | null;
    lastError?: string | null;
    timestamp?: number;
    capturedByUserId?: string | null;
    rescuedAt?: number;
  },
  userId: string,
  now: number = Date.now(),
): { eligible: boolean; reason?: 'no-blob' | 'other-user' | 'already-rescued' | 'not-stuck-or-dead' } {
  if (photo.uploaded !== 0) return { eligible: false, reason: 'not-stuck-or-dead' };
  if (!photo.blob || photo.blob.size === 0) return { eligible: false, reason: 'no-blob' };
  if (photo.rescuedAt) return { eligible: false, reason: 'already-rescued' };
  if (photo.capturedByUserId && photo.capturedByUserId !== userId) {
    return { eligible: false, reason: 'other-user' };
  }

  const retryCount = photo.retryCount ?? 0;
  const isDeadLetter = retryCount >= MAX_PHOTO_RETRIES;
  const isStuck =
    retryCount === 0 &&
    !photo.nextRetryAt &&
    !photo.lastError &&
    typeof photo.timestamp === 'number' &&
    now - photo.timestamp >= STUCK_AGE_MS;

  if (!isDeadLetter && !isStuck) return { eligible: false, reason: 'not-stuck-or-dead' };
  return { eligible: true };
}

/**
 * Run the sweep regardless of the localStorage marker. Returns a summary.
 * Safe to call multiple times — the rescuedAt stamp keeps it idempotent.
 */
export async function runPhotoRescueSweep(userId: string): Promise<RescueSweepResult> {
  if (!userId) return { ...EMPTY };

  const result: RescueSweepResult = { ...EMPTY };
  const now = Date.now();

  try {
    const db = await getDB();
    const tx = db.transaction('photos', 'readwrite');
    const index = tx.store.index('by-uploaded');
    const unuploaded = await index.getAll(IDBKeyRange.only(0));
    result.scanned = unuploaded.length;

    const rescuedIds: string[] = [];

    for (const photo of unuploaded) {
      const check = isRescueEligible(photo, userId, now);
      if (!check.eligible) {
        if (check.reason === 'no-blob') result.skippedNoBlob += 1;
        else if (check.reason === 'other-user') result.skippedOtherUser += 1;
        else if (check.reason === 'already-rescued') result.skippedAlreadyRescued += 1;
        continue;
      }

      photo.retryCount = 0;
      photo.nextRetryAt = null;
      photo.lastError = null;
      photo.lastErrorAt = null;
      photo.transientCount = 0;
      photo.rescuedAt = now;
      // uploaded already === 0; do not touch blob, photoUrl, inspectionId,
      // capturedByUserId, fileName, section.
      await tx.store.put(photo);
      rescuedIds.push(photo.id);
      result.rescued += 1;
    }

    await tx.done;

    // Best-effort: clear matching dead-letter mirror rows. Failures are
    // ignored — a successful re-upload supersedes the mirror anyway.
    for (const id of rescuedIds) {
      try {
        await removePhotoUploadFailure(id);
      } catch {
        /* noop */
      }
    }

    syncLog.log('[Photo Rescue Sweep] Complete', result);
  } catch (err) {
    console.warn('[Photo Rescue Sweep] Failed:', err);
  }

  return result;
}

/**
 * Boot entry point — runs the sweep once per device, then never again unless
 * the marker is cleared via clearRescueSweepMarker(). Notifies the user via
 * the Sync Terminal if any photos were re-queued.
 */
export async function maybeRunPhotoRescueSweep(userId: string | null | undefined): Promise<RescueSweepResult | null> {
  if (!userId) return null;
  if (hasCompleted()) return null;

  const result = await runPhotoRescueSweep(userId);
  markCompleted();

  if (result.rescued > 0) {
    addSyncNotification(
      `Rescue sweep: ${result.rescued} previously failed photo${result.rescued === 1 ? '' : 's'} re-queued for upload`,
    );
  }

  return result;
}
