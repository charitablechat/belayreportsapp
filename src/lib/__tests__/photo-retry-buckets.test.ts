import { describe, it, expect } from 'vitest';
import {
  bucketPhotos,
  isStuckPhotoCandidate,
  STUCK_PHOTO_AGE_MS,
} from '@/lib/photo-retry-buckets';

const FAKE_BLOB = new Blob(['x'], { type: 'image/jpeg' });

interface Photo {
  id?: string;
  uploaded?: number;
  retryCount?: number;
  nextRetryAt?: number | null;
  lastError?: string | null;
  blob?: Blob | null;
  timestamp?: number;
}

const ready = (id: string): Photo => ({
  id,
  uploaded: 0,
  retryCount: 0,
  nextRetryAt: null,
  lastError: null,
  blob: FAKE_BLOB,
  timestamp: Date.now() - 30_000, // 30s old → not yet stuck
});

const retrying = (id: string, retryAtOffsetMs: number): Photo => ({
  id,
  uploaded: 0,
  retryCount: 1,
  nextRetryAt: Date.now() + retryAtOffsetMs,
  lastError: 'transient flake',
  blob: FAKE_BLOB,
  timestamp: Date.now() - 60_000,
});

const stuck = (id: string, ageMin = 10): Photo => ({
  id,
  uploaded: 0,
  retryCount: 0,
  nextRetryAt: null,
  lastError: null,
  blob: FAKE_BLOB,
  timestamp: Date.now() - ageMin * 60_000,
});

const deadLetter = (id: string): Photo => ({
  id,
  uploaded: 0,
  retryCount: 5, // MAX_PHOTO_RETRIES
  nextRetryAt: null,
  lastError: 'failed 5x',
  blob: FAKE_BLOB,
  timestamp: Date.now() - 60_000,
});

describe('isStuckPhotoCandidate', () => {
  it('matches the exact 0/0/null/null pattern after 5+ minutes', () => {
    expect(isStuckPhotoCandidate(stuck('p1', 6))).toBe(true);
  });

  it('does not match photos under 5 minutes old', () => {
    expect(isStuckPhotoCandidate(stuck('p1', 1))).toBe(false);
  });

  it('does not match photos with retryCount > 0', () => {
    expect(isStuckPhotoCandidate(retrying('p1', -1000))).toBe(false);
  });

  it('does not match photos in backoff window', () => {
    expect(isStuckPhotoCandidate(retrying('p1', 30_000))).toBe(false);
  });

  it('does not match photos with lastError set', () => {
    const p = stuck('p1', 30);
    p.lastError = 'oops';
    expect(isStuckPhotoCandidate(p)).toBe(false);
  });

  it('does not match photos with blob nulled (post-upload)', () => {
    const p = stuck('p1', 30);
    p.blob = null;
    expect(isStuckPhotoCandidate(p)).toBe(false);
  });

  it('default age threshold is 5 minutes', () => {
    expect(STUCK_PHOTO_AGE_MS).toBe(5 * 60 * 1000);
  });
});

describe('bucketPhotos', () => {
  it('returns all-zero buckets for an empty list', () => {
    const r = bucketPhotos([]);
    expect(r).toEqual({
      ready: 0,
      retrying: 0,
      stuck: 0,
      blocked: 0,
      retryingMinNextRetryAt: null,
      stuckIds: [],
      blockedParentIds: [],
    });
  });

  it('classifies photos with temp-* parent as BLOCKED, regardless of backoff', () => {
    const tempParent: Photo & { inspectionId: string } = {
      id: 'p1',
      uploaded: 0,
      retryCount: 0,
      nextRetryAt: null,
      lastError: null,
      blob: FAKE_BLOB,
      timestamp: Date.now() - 60_000,
      inspectionId: 'temp-abc-123',
    };
    const r = bucketPhotos([tempParent, ready('r1')]);
    expect(r.blocked).toBe(1);
    expect(r.blockedParentIds).toEqual(['temp-abc-123']);
    expect(r.ready).toBe(1);
  });

  it('counts READY photos (recent, no nextRetryAt, retryCount=0)', () => {
    const r = bucketPhotos([ready('p1'), ready('p2'), ready('p3')]);
    expect(r.ready).toBe(3);
    expect(r.retrying).toBe(0);
    expect(r.stuck).toBe(0);
  });

  it('counts RETRYING photos and exposes the earliest nextRetryAt', () => {
    const r = bucketPhotos([
      retrying('p1', 60_000), // +60s
      retrying('p2', 30_000), // +30s ← earliest
      retrying('p3', 120_000),
    ]);
    expect(r.retrying).toBe(3);
    expect(r.retryingMinNextRetryAt).not.toBeNull();
    const delta = (r.retryingMinNextRetryAt ?? 0) - Date.now();
    expect(delta).toBeGreaterThan(28_000);
    expect(delta).toBeLessThan(32_000);
  });

  it('counts STUCK photos separately from READY and exposes their ids', () => {
    const r = bucketPhotos([
      ready('young1'),
      stuck('old1', 10),
      stuck('old2', 30),
      stuck('old3', 6),
    ]);
    expect(r.ready).toBe(1);
    expect(r.stuck).toBe(3);
    expect(r.stuckIds.sort()).toEqual(['old1', 'old2', 'old3']);
  });

  it('excludes dead-letter photos (retryCount >= MAX_PHOTO_RETRIES)', () => {
    const r = bucketPhotos([deadLetter('dl1'), deadLetter('dl2'), ready('r1')]);
    expect(r.ready).toBe(1);
    expect(r.retrying).toBe(0);
    expect(r.stuck).toBe(0);
  });

  it('excludes photos whose blob has been nulled (post-upload)', () => {
    const p = ready('p1');
    p.blob = null;
    const r = bucketPhotos([p, ready('p2')]);
    expect(r.ready).toBe(1);
  });

  it('photos with nextRetryAt in the past fall through to READY', () => {
    const past = retrying('p1', -60_000); // nextRetryAt 60s ago
    const r = bucketPhotos([past]);
    expect(r.retrying).toBe(0);
    expect(r.ready).toBe(1); // no longer in backoff window
  });

  it('handles a mixed batch correctly', () => {
    const photos: Photo[] = [
      ready('r1'),
      ready('r2'),
      retrying('rt1', 45_000),
      retrying('rt2', 15_000),
      stuck('s1', 10),
      stuck('s2', 30),
      deadLetter('dl1'),
    ];
    const r = bucketPhotos(photos);
    expect(r.ready).toBe(2);
    expect(r.retrying).toBe(2);
    expect(r.stuck).toBe(2);
    expect(r.stuckIds.sort()).toEqual(['s1', 's2']);
    expect(r.retryingMinNextRetryAt).not.toBeNull();
  });
});
