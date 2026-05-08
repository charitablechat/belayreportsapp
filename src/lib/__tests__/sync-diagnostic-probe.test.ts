/**
 * Sprint 2 I: contract tests for the one-shot sync diagnostic probe.
 *
 * Pins the never-throws guarantee: every internal probe failure surfaces
 * as `{ error: <message> }` on the relevant section without breaking
 * downstream sections.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock heavy collaborators before importing the module under test.
vi.mock('../offline-storage', () => ({
  getDB: vi.fn(),
  isIdbLayerBreakerOpen: vi.fn(() => false),
  isInPostOnlineRecoveryGrace: vi.fn(() => false),
  getCircuitBreakerStatus: vi.fn(() => ({
    open: false,
    failureCount: 0,
    byStore: {
      global: { open: false, failureCount: 0, resetIn: null, backoffLevel: 0 },
    },
  })),
  getUnsyncedInspections: vi.fn(async () => []),
  getUnsyncedTrainings: vi.fn(async () => []),
  getUnsyncedDailyAssessments: vi.fn(async () => []),
  getDeadLetterPhotos: vi.fn(async () => []),
}));

vi.mock('../cached-auth', () => ({
  getUserWithCache: vi.fn(async () => ({ id: 'user-test-1', email: 't@e.com' })),
}));

vi.mock('../photo-retry-buckets', () => ({
  getPhotoRetryBuckets: vi.fn(async () => ({
    ready: 1,
    retrying: 2,
    stuck: 0,
    retryingMinNextRetryAt: null,
    stuckIds: [],
  })),
}));

vi.mock('../sync-quarantine', () => ({
  getQuarantineSnapshot: vi.fn(() => ({})),
}));

vi.mock('../sync-halt-tracker', () => ({
  getSyncHaltState: vi.fn(() => null),
}));

vi.mock('../attestation', () => ({
  APP_VERSION: '4.7.999',
  APP_VERSION_FULL: '4.7.999+test',
}));

import { runSyncDiagnostic, formatSyncDiagnostic } from '../sync-diagnostic-probe';
import * as offlineStorage from '../offline-storage';
import * as cachedAuth from '../cached-auth';

describe('runSyncDiagnostic — happy path', () => {
  beforeEach(() => {
    vi.mocked(offlineStorage.getDB).mockResolvedValue({} as never);
  });

  it('returns a flat JSON-serializable shape with every gate populated', async () => {
    const report = await runSyncDiagnostic();
    expect(report.timestamp).toBeGreaterThan(0);
    expect(typeof report.capturedAt).toBe('string');
    expect(report.app.version).toBe('4.7.999');
    expect(report.app.versionFull).toBe('4.7.999+test');
    expect(typeof report.network.navigatorOnLine === 'boolean' || report.network.navigatorOnLine === null).toBe(true);
    expect(report.auth).toEqual({ hasCachedUser: true, userId: 'user-test-1' });
    expect(report.idb).toMatchObject({
      readable: true,
      layerBreakerOpen: false,
      inPostOnlineRecoveryGrace: false,
    });
    expect(report.photos).toMatchObject({ ready: 1, retrying: 2, stuck: 0, deadLetterCount: 0 });
    expect(report.recordsByTable).toEqual({ inspections: 0, trainings: 0, dailyAssessments: 0 });
    expect(report.quarantine).toEqual({ total: 0 });
  });

  it('produces a stable JSON-roundtrippable payload', async () => {
    const report = await runSyncDiagnostic();
    const text = formatSyncDiagnostic(report);
    expect(text.startsWith('=== RopeWorks sync diagnostic — ')).toBe(true);
    // The body after the header should parse as JSON.
    const jsonStart = text.indexOf('\n') + 1;
    expect(() => JSON.parse(text.slice(jsonStart))).not.toThrow();
  });
});

describe('runSyncDiagnostic — failure tolerance', () => {
  it('surfaces auth failure as { error } without breaking other sections', async () => {
    vi.mocked(cachedAuth.getUserWithCache).mockRejectedValueOnce(new Error('auth blew up'));
    vi.mocked(offlineStorage.getDB).mockResolvedValue({} as never);
    const report = await runSyncDiagnostic();
    expect(report.auth).toEqual({ error: 'auth blew up' });
    // IDB still populated.
    expect(report.idb).toMatchObject({ readable: true });
    // Photos still populated.
    expect(report.photos).toMatchObject({ ready: 1 });
  });

  it('surfaces idb failure as { error } and continues', async () => {
    vi.mocked(offlineStorage.getDB).mockRejectedValueOnce(new Error('DOMException: NotReadableError'));
    const report = await runSyncDiagnostic();
    expect(report.idb).toEqual({ error: 'DOMException: NotReadableError' });
    expect(report.recordsByTable).toEqual({ inspections: 0, trainings: 0, dailyAssessments: 0 });
  });

  it('surfaces photos failure as { error } when getPhotoRetryBuckets rejects', async () => {
    const photoMod = await import('../photo-retry-buckets');
    vi.mocked(photoMod.getPhotoRetryBuckets).mockRejectedValueOnce(new Error('photo read failed'));
    vi.mocked(offlineStorage.getDB).mockResolvedValue({} as never);
    const report = await runSyncDiagnostic();
    expect(report.photos).toEqual({ error: 'photo read failed' });
  });

  it('never throws even if multiple probes fail simultaneously', async () => {
    vi.mocked(cachedAuth.getUserWithCache).mockRejectedValueOnce(new Error('a'));
    vi.mocked(offlineStorage.getDB).mockRejectedValueOnce(new Error('b'));
    const photoMod = await import('../photo-retry-buckets');
    vi.mocked(photoMod.getPhotoRetryBuckets).mockRejectedValueOnce(new Error('c'));
    vi.mocked(offlineStorage.getUnsyncedInspections).mockRejectedValueOnce(new Error('d'));

    await expect(runSyncDiagnostic()).resolves.toBeDefined();
  });
});

describe('formatSyncDiagnostic', () => {
  it('includes the timestamp header for support-side matching', async () => {
    vi.mocked(offlineStorage.getDB).mockResolvedValue({} as never);
    const report = await runSyncDiagnostic();
    const text = formatSyncDiagnostic(report);
    expect(text).toContain('=== RopeWorks sync diagnostic — ');
    expect(text).toContain(report.capturedAt);
  });
});
