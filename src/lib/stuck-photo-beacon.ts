/**
 * Stuck-photo beacon.
 *
 * The audit (2026-04-22, iPad-stuck-pending) identified an "0,0,null" edge
 * case: a photo with `uploaded=0, retryCount=0, nextRetryAt=null, lastError=null`
 * that has been sitting in IDB for several minutes without ever being
 * attempted. This typically happens when one of useAutoSync.performSync's
 * silent-halt paths fires repeatedly, so the photo never reaches sync-manager
 * and never accrues a retry/error stamp. From the user's point of view the
 * badge says "37 PENDING" and never moves; from the dashboard's point of
 * view there is nothing to look at — Sentry never fires because no error
 * was thrown, and the per-photo UI shows no error history.
 *
 * This module closes that observability gap by scanning for the stuck
 * pattern once per sync cycle (cheap: one indexed IDB query) and
 * reporting it to Sentry as `level=warning`. Reports are debounced
 * per-photoId per-tab via sessionStorage so a long-stuck photo doesn't
 * generate one event per cycle, and capped per session to bound the
 * volume even if a single inspection has many stuck photos.
 *
 * Caller contract: invoke from `useAutoSync` post-cycle (after photos
 * have been counted) and not too frequently — once per `performSync`
 * tick is fine. The function is best-effort and never throws.
 */
import { getDB } from './offline-storage';
import { captureException } from './sentry';
import { syncLog } from './sync-logger';

/** Photos older than this with no retry/error stamp count as "stuck". */
export const STUCK_PHOTO_AGE_MS = 5 * 60 * 1000;

/** Hard cap on how many beacons a single tab session can fire. */
export const MAX_BEACONS_PER_SESSION = 5;

/**
 * sessionStorage key used to remember which photoIds have already been
 * reported and how many beacons we've fired so far. We keep the key
 * versioned so a future schema change doesn't collide with a stale value
 * in long-lived tabs.
 */
const SESSION_KEY = 'stuck-photo-beacon:v1';

interface SessionState {
  reported: string[];
  fired: number;
}

function readSession(): SessionState {
  try {
    if (typeof sessionStorage === 'undefined') {
      return { reported: [], fired: 0 };
    }
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return { reported: [], fired: 0 };
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    return {
      reported: Array.isArray(parsed.reported) ? parsed.reported : [],
      fired: typeof parsed.fired === 'number' ? parsed.fired : 0,
    };
  } catch {
    return { reported: [], fired: 0 };
  }
}

function writeSession(state: SessionState): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    /* sessionStorage may be unavailable in private mode — best-effort */
  }
}

export interface StuckPhotoSummary {
  /** photoIds that matched the stuck-photo predicate during this scan. */
  matched: string[];
  /** photoIds that resulted in a fresh Sentry beacon (post-debounce/cap). */
  reported: string[];
  /** True if the per-session cap was reached and remaining matches were skipped. */
  capReached: boolean;
}

interface PhotoForScan {
  id: string;
  inspectionId?: string;
  uploaded?: 0 | 1;
  retryCount?: number;
  nextRetryAt?: number | null;
  lastError?: string | null;
  blob?: Blob | null;
  timestamp?: number;
  fileName?: string;
}

/**
 * Pure predicate so it can be unit-tested without touching IDB. Public for
 * tests only.
 */
export function isStuckPhotoCandidate(
  photo: PhotoForScan,
  now: number = Date.now(),
  ageThresholdMs: number = STUCK_PHOTO_AGE_MS,
): boolean {
  if (photo.uploaded !== 0) return false;
  if ((photo.retryCount ?? 0) !== 0) return false;
  if (photo.nextRetryAt) return false;
  if (photo.lastError) return false;
  if (!photo.blob) return false; // post-upload row with blob nulled — not stuck
  if (typeof photo.timestamp !== 'number') return false;
  return now - photo.timestamp >= ageThresholdMs;
}

/**
 * Scan for stuck photos and emit Sentry beacons for previously-unreported
 * ones, respecting the per-session cap. Best-effort; returns an empty
 * summary on any internal failure.
 */
export async function scanForStuckPhotos(): Promise<StuckPhotoSummary> {
  const empty: StuckPhotoSummary = { matched: [], reported: [], capReached: false };
  let db: Awaited<ReturnType<typeof getDB>>;
  try {
    db = await getDB();
  } catch (e) {
    syncLog.warn('[StuckPhotoBeacon] getDB failed', e);
    return empty;
  }

  let unuploaded: PhotoForScan[];
  try {
    const tx = db.transaction('photos', 'readonly');
    const idx = tx.store.index('by-uploaded');
    unuploaded = (await idx.getAll(IDBKeyRange.only(0))) as PhotoForScan[];
    await tx.done;
  } catch (e) {
    syncLog.warn('[StuckPhotoBeacon] photos read failed', e);
    return empty;
  }

  const now = Date.now();
  const matched = unuploaded.filter((p) => isStuckPhotoCandidate(p, now)).map(
    (p) => p.id,
  );
  if (matched.length === 0) return empty;

  const session = readSession();
  const alreadyReported = new Set(session.reported);
  const reported: string[] = [];
  let fired = session.fired;
  let capReached = false;

  for (const photo of unuploaded) {
    if (!matched.includes(photo.id)) continue;
    if (alreadyReported.has(photo.id)) continue;
    if (fired >= MAX_BEACONS_PER_SESSION) {
      capReached = true;
      break;
    }
    const ageMs = typeof photo.timestamp === 'number' ? now - photo.timestamp : null;
    try {
      captureException(
        new Error('Stuck photo detected (uploaded=0, retryCount=0, nextRetryAt=null, lastError=null)'),
        {
          photoId: photo.id,
          inspectionId: photo.inspectionId ?? null,
          fileName: photo.fileName ?? null,
          ageMs,
          ageMinutes: ageMs !== null ? Math.round(ageMs / 60_000) : null,
          uploaded: photo.uploaded ?? null,
          retryCount: photo.retryCount ?? 0,
          nextRetryAt: photo.nextRetryAt ?? null,
          lastError: photo.lastError ?? null,
          totalUnuploaded: unuploaded.length,
          totalStuck: matched.length,
        },
        {
          level: 'warning',
          fingerprint: ['stuck-photo-beacon', 'uploaded=0,retryCount=0,nextRetryAt=null'],
        },
      );
      reported.push(photo.id);
      fired += 1;
    } catch (e) {
      syncLog.warn('[StuckPhotoBeacon] captureException threw', e);
    }
  }

  if (reported.length > 0) {
    writeSession({
      reported: [...alreadyReported, ...reported],
      fired,
    });
    syncLog.log(
      `[StuckPhotoBeacon] reported ${reported.length} stuck photo(s); session total=${fired}/${MAX_BEACONS_PER_SESSION}`,
    );
  }

  return { matched, reported, capReached };
}

/**
 * Test-only — clear session state between vitest runs.
 */
export function __resetStuckPhotoBeaconForTests(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* ignore */
  }
}
