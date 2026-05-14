/**
 * Photo retry-state bucketing for the Sync Terminal "PENDING_PHOTOS" surface.
 *
 * Sprint 1D from the iPad-stuck-pending audit (Finding 5).
 *
 * Replaces the single `PENDING_PHOTOS: <n>` row with a three-bucket
 * breakdown so users (and Belay specifically) can tell apart:
 *
 *   READY    — photo will be attempted on the next sync cycle (no
 *               nextRetryAt window, retryCount < MAX, blob present).
 *   RETRYING — photo failed once and is sitting inside its jittered
 *               backoff window from PR #151. The earliest `nextRetryAt`
 *               is exposed so the UI can show a countdown.
 *   STUCK    — the "0,0,null" pattern that PR B's Sentry beacon also
 *               flags: uploaded=0, retryCount=0, nextRetryAt=null,
 *               lastError=null, blob present, age > 5min. These photos
 *               never got attempted because performSync silently halted
 *               before sync-manager ran. The Sync Terminal exposes a
 *               "RETRY NOW" button that resets retryCount + nextRetryAt
 *               and force-triggers a sync.
 *
 * Photos with `retryCount >= MAX_PHOTO_RETRIES` are dead-letter (already
 * surfaced by `getDeadLetterPhotos()`) and are excluded from all three
 * buckets.
 *
 * Bucketing is mutually exclusive: STUCK is a strict subset of what
 * would otherwise be READY, but is reported separately so the user
 * can see "0,0,null" photos as a distinct concerning state.
 */

import { getDB, MAX_PHOTO_RETRIES } from '@/lib/offline-storage';

/** Age threshold past which a never-attempted photo is considered STUCK. */
export const STUCK_PHOTO_AGE_MS = 5 * 60 * 1000;

export interface PhotoRetryBuckets {
  /** Eligible photos that will be attempted on the next sync cycle. */
  ready: number;
  /** Photos in jittered-backoff (PR #151), waiting for `nextRetryAt`. */
  retrying: number;
  /** Subset of READY: never attempted (0/0/null/null), age > 5min. */
  stuck: number;
  /**
   * P0 (audit): photos whose parent inspection is still on a `temp-*` id
   * — `syncPhotos` skips these without bumping `retryCount`, so they sit
   * in PENDING forever. The bottleneck is the parent record, not the photo.
   */
  blocked: number;
  /** Earliest `nextRetryAt` across the RETRYING bucket, or null. */
  retryingMinNextRetryAt: number | null;
  /** Photo IDs in the STUCK bucket (used by the "Retry now" button). */
  stuckIds: string[];
  /** Distinct parent inspection ids in the BLOCKED bucket. */
  blockedParentIds: string[];
}

interface PhotoLike {
  id?: string;
  uploaded?: number;
  retryCount?: number;
  nextRetryAt?: number | null;
  lastError?: string | null;
  blob?: Blob | null;
  timestamp?: number;
  inspectionId?: string;
}

/**
 * Pure predicate: does this photo match the "0,0,null" stuck pattern
 * (the same one PR B's Sentry beacon fires on)?
 *
 * Exposed for unit testing.
 */
export function isStuckPhotoCandidate(
  photo: PhotoLike,
  now: number = Date.now(),
  ageThresholdMs: number = STUCK_PHOTO_AGE_MS,
): boolean {
  if (photo.uploaded !== 0) return false;
  if ((photo.retryCount ?? 0) !== 0) return false;
  if (photo.nextRetryAt) return false;
  if (photo.lastError) return false;
  if (!photo.blob) return false;
  if (typeof photo.timestamp !== 'number') return false;
  return now - photo.timestamp >= ageThresholdMs;
}

const EMPTY: PhotoRetryBuckets = {
  ready: 0,
  retrying: 0,
  stuck: 0,
  blocked: 0,
  retryingMinNextRetryAt: null,
  stuckIds: [],
  blockedParentIds: [],
};

/**
 * Pure bucketing helper. Exposed for unit testing.
 */
export function bucketPhotos(
  photos: PhotoLike[],
  now: number = Date.now(),
): PhotoRetryBuckets {
  let ready = 0;
  let retrying = 0;
  let stuck = 0;
  let blocked = 0;
  let retryingMinNextRetryAt: number | null = null;
  const stuckIds: string[] = [];
  const blockedParents = new Set<string>();

  for (const photo of photos) {
    if (!photo.blob) continue;
    if ((photo.retryCount ?? 0) >= MAX_PHOTO_RETRIES) continue;

    // BLOCKED takes precedence: parent inspection still on a temp-* id,
    // so syncPhotos will skip this photo regardless of backoff state.
    if (typeof photo.inspectionId === 'string' && photo.inspectionId.startsWith('temp-')) {
      blocked += 1;
      blockedParents.add(photo.inspectionId);
      continue;
    }

    if (photo.nextRetryAt && photo.nextRetryAt > now) {
      retrying += 1;
      if (
        retryingMinNextRetryAt === null ||
        photo.nextRetryAt < retryingMinNextRetryAt
      ) {
        retryingMinNextRetryAt = photo.nextRetryAt;
      }
      continue;
    }

    if (isStuckPhotoCandidate(photo, now)) {
      stuck += 1;
      if (photo.id) stuckIds.push(photo.id);
      continue;
    }

    ready += 1;
  }

  return {
    ready,
    retrying,
    stuck,
    blocked,
    retryingMinNextRetryAt,
    stuckIds,
    blockedParentIds: Array.from(blockedParents),
  };
}

/**
 * Bucket every unuploaded photo into READY / RETRYING / STUCK.
 *
 * Read-only IDB query against the `by-uploaded` index so the cost is
 * O(unuploaded), not O(all photos). Returns `EMPTY` on any IDB hiccup
 * — never throws — so a transient read failure can't blank the badge.
 */
export async function getPhotoRetryBuckets(): Promise<PhotoRetryBuckets> {
  try {
    const db = await getDB();
    const tx = db.transaction('photos', 'readonly');
    const index = tx.store.index('by-uploaded');
    const unuploaded = await index.getAll(IDBKeyRange.only(0));
    await tx.done;
    return bucketPhotos(unuploaded);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[photo-retry-buckets] read failed, returning empty:', err);
    }
    return EMPTY;
  }
}
