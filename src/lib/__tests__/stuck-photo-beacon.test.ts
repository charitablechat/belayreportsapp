import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isStuckPhotoCandidate,
  STUCK_PHOTO_AGE_MS,
  MAX_BEACONS_PER_SESSION,
  __resetStuckPhotoBeaconForTests,
} from '@/lib/stuck-photo-beacon';

const captureExceptionMock = vi.fn();
vi.mock('@/lib/sentry', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

interface FakePhoto {
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

let fakePhotos: FakePhoto[] = [];
const getDBMock = vi.fn(async () => ({
  transaction: () => ({
    store: {
      index: () => ({
        getAll: async () =>
          fakePhotos.filter((p) => p.uploaded === 0),
      }),
    },
    done: Promise.resolve(),
  }),
}));

vi.mock('@/lib/offline-storage', () => ({
  getDB: () => getDBMock(),
}));

vi.mock('@/lib/sync-logger', () => ({
  syncLog: {
    log: vi.fn(),
    warn: vi.fn(),
  },
}));

const FAKE_BLOB = new Blob(['x'], { type: 'image/jpeg' });

const makeStuck = (id: string, ageMinutes = 10): FakePhoto => ({
  id,
  inspectionId: `insp-${id}`,
  fileName: `${id}.jpg`,
  uploaded: 0,
  retryCount: 0,
  nextRetryAt: null,
  lastError: null,
  blob: FAKE_BLOB,
  timestamp: Date.now() - ageMinutes * 60_000,
});

describe('isStuckPhotoCandidate', () => {
  beforeEach(() => {
    __resetStuckPhotoBeaconForTests();
  });

  it('matches the exact 0/0/null/null pattern after 5+ minutes', () => {
    expect(isStuckPhotoCandidate(makeStuck('p1', 6))).toBe(true);
  });

  it('does not match photos under 5 minutes old', () => {
    expect(isStuckPhotoCandidate(makeStuck('p1', 1))).toBe(false);
  });

  it('does not match an already-uploaded photo', () => {
    const p = makeStuck('p1', 30);
    p.uploaded = 1;
    expect(isStuckPhotoCandidate(p)).toBe(false);
  });

  it('does not match if retryCount > 0 (sync already attempted)', () => {
    const p = makeStuck('p1', 30);
    p.retryCount = 1;
    expect(isStuckPhotoCandidate(p)).toBe(false);
  });

  it('does not match if nextRetryAt is set (in backoff window)', () => {
    const p = makeStuck('p1', 30);
    p.nextRetryAt = Date.now() + 30_000;
    expect(isStuckPhotoCandidate(p)).toBe(false);
  });

  it('does not match if lastError is set (errored, not stuck)', () => {
    const p = makeStuck('p1', 30);
    p.lastError = 'failed to upload';
    expect(isStuckPhotoCandidate(p)).toBe(false);
  });

  it('does not match if blob has been nulled (post-upload row)', () => {
    const p = makeStuck('p1', 30);
    p.blob = null;
    expect(isStuckPhotoCandidate(p)).toBe(false);
  });

  it('does not match if timestamp is missing', () => {
    const p = makeStuck('p1', 30);
    delete p.timestamp;
    expect(isStuckPhotoCandidate(p)).toBe(false);
  });

  it('respects custom ageThresholdMs', () => {
    const p = makeStuck('p1', 3); // 3 min old
    expect(isStuckPhotoCandidate(p, Date.now(), 1 * 60_000)).toBe(true);
    expect(isStuckPhotoCandidate(p, Date.now(), 10 * 60_000)).toBe(false);
  });

  it('exposes a 5-minute default age threshold', () => {
    expect(STUCK_PHOTO_AGE_MS).toBe(5 * 60 * 1000);
  });
});

describe('scanForStuckPhotos', () => {
  beforeEach(async () => {
    fakePhotos = [];
    captureExceptionMock.mockReset();
    getDBMock.mockClear();
    sessionStorage.clear();
    __resetStuckPhotoBeaconForTests();
  });

  it('returns empty summary when no photos are stuck', async () => {
    const { scanForStuckPhotos } = await import('@/lib/stuck-photo-beacon');
    fakePhotos = [makeStuck('p1', 1)]; // too young to count
    const r = await scanForStuckPhotos();
    expect(r.matched).toEqual([]);
    expect(r.reported).toEqual([]);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('fires a Sentry beacon for each stuck photo on first encounter', async () => {
    const { scanForStuckPhotos } = await import('@/lib/stuck-photo-beacon');
    fakePhotos = [makeStuck('p1', 10), makeStuck('p2', 12)];
    const r = await scanForStuckPhotos();
    expect(r.matched.sort()).toEqual(['p1', 'p2']);
    expect(r.reported.sort()).toEqual(['p1', 'p2']);
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
    const [, ctx, options] = captureExceptionMock.mock.calls[0];
    expect(ctx.photoId).toBe('p1');
    expect(ctx.inspectionId).toBe('insp-p1');
    expect(typeof ctx.ageMs).toBe('number');
    expect(ctx.ageMs).toBeGreaterThan(STUCK_PHOTO_AGE_MS);
    expect(options.level).toBe('warning');
    expect(options.fingerprint).toContain('stuck-photo-beacon');
  });

  it('debounces: a photoId already reported in the same session does not re-fire', async () => {
    const { scanForStuckPhotos } = await import('@/lib/stuck-photo-beacon');
    fakePhotos = [makeStuck('p1', 10)];
    await scanForStuckPhotos();
    captureExceptionMock.mockClear();
    await scanForStuckPhotos();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('caps total session beacons at MAX_BEACONS_PER_SESSION', async () => {
    const { scanForStuckPhotos } = await import('@/lib/stuck-photo-beacon');
    fakePhotos = Array.from({ length: MAX_BEACONS_PER_SESSION + 3 }, (_, i) =>
      makeStuck(`p${i}`, 10),
    );
    const r = await scanForStuckPhotos();
    expect(r.matched).toHaveLength(MAX_BEACONS_PER_SESSION + 3);
    expect(r.reported).toHaveLength(MAX_BEACONS_PER_SESSION);
    expect(r.capReached).toBe(true);
    expect(captureExceptionMock).toHaveBeenCalledTimes(MAX_BEACONS_PER_SESSION);
  });

  it('returns empty summary when getDB throws', async () => {
    getDBMock.mockRejectedValueOnce(new Error('IDB closed'));
    const { scanForStuckPhotos } = await import('@/lib/stuck-photo-beacon');
    const r = await scanForStuckPhotos();
    expect(r.matched).toEqual([]);
    expect(r.reported).toEqual([]);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
