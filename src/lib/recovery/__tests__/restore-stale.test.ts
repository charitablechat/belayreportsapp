import { describe, it, expect } from 'vitest';
import { compareSnapshotFreshness } from '@/lib/recovery/restore-stale';

describe('compareSnapshotFreshness', () => {
  it('returns "fresh" when liveMissing is true regardless of timestamps', () => {
    expect(
      compareSnapshotFreshness({
        snapshotUpdatedAt: null,
        liveUpdatedAt: null,
        liveMissing: true,
      }),
    ).toBe('fresh');
  });

  it('returns "fresh" when snapshot is newer than live', () => {
    expect(
      compareSnapshotFreshness({
        snapshotUpdatedAt: '2026-02-01T00:00:00Z',
        liveUpdatedAt: '2026-01-01T00:00:00Z',
      }),
    ).toBe('fresh');
  });

  it('returns "fresh" when timestamps are equal', () => {
    expect(
      compareSnapshotFreshness({
        snapshotUpdatedAt: '2026-01-01T00:00:00Z',
        liveUpdatedAt: '2026-01-01T00:00:00Z',
      }),
    ).toBe('fresh');
  });

  it('returns "stale" when live is strictly newer', () => {
    expect(
      compareSnapshotFreshness({
        snapshotUpdatedAt: '2026-01-01T00:00:00Z',
        liveUpdatedAt: '2026-02-01T00:00:00Z',
      }),
    ).toBe('stale');
  });

  it('returns "unknown" when snapshot updated_at is missing', () => {
    expect(
      compareSnapshotFreshness({
        snapshotUpdatedAt: null,
        liveUpdatedAt: '2026-01-01T00:00:00Z',
      }),
    ).toBe('unknown');
  });

  it('returns "unknown" when live updated_at is missing (but live exists)', () => {
    expect(
      compareSnapshotFreshness({
        snapshotUpdatedAt: '2026-01-01T00:00:00Z',
        liveUpdatedAt: undefined,
      }),
    ).toBe('unknown');
  });

  it('returns "unknown" when either side is unparseable', () => {
    expect(
      compareSnapshotFreshness({
        snapshotUpdatedAt: 'not-a-date',
        liveUpdatedAt: '2026-01-01T00:00:00Z',
      }),
    ).toBe('unknown');
    expect(
      compareSnapshotFreshness({
        snapshotUpdatedAt: '2026-01-01T00:00:00Z',
        liveUpdatedAt: 'also-not-a-date',
      }),
    ).toBe('unknown');
  });

  it('accepts numeric timestamps', () => {
    expect(
      compareSnapshotFreshness({
        snapshotUpdatedAt: 1735689600000,
        liveUpdatedAt: 1735689500000,
      }),
    ).toBe('fresh');
    expect(
      compareSnapshotFreshness({
        snapshotUpdatedAt: 1735689500000,
        liveUpdatedAt: 1735689600000,
      }),
    ).toBe('stale');
  });
});
