import { describe, it, expect } from 'vitest';
import { isLocalDataNewer, shouldPreserveLocalRecord, SYNC_DRIFT_TOLERANCE_MS } from './local-data-guards';

describe('isLocalDataNewer', () => {
  it('returns false when offlineData is null', () => {
    expect(isLocalDataNewer(null, { updated_at: '2025-01-01T00:00:00Z' })).toBe(false);
  });

  it('returns false when offlineData is undefined', () => {
    expect(isLocalDataNewer(undefined, { updated_at: '2025-01-01T00:00:00Z' })).toBe(false);
  });

  it('returns true when offlineData has no synced_at (never synced)', () => {
    expect(isLocalDataNewer(
      { updated_at: '2025-01-01T00:00:00Z', synced_at: null },
      { updated_at: '2025-01-02T00:00:00Z' }
    )).toBe(true);
  });

  it('returns true when offlineData has undefined synced_at', () => {
    expect(isLocalDataNewer(
      { updated_at: '2025-01-01T00:00:00Z' },
      { updated_at: '2025-01-02T00:00:00Z' }
    )).toBe(true);
  });

  it('returns true when local updated_at is newer than server', () => {
    expect(isLocalDataNewer(
      { updated_at: '2025-01-02T12:00:00Z', synced_at: '2025-01-01T00:00:00Z' },
      { updated_at: '2025-01-01T00:00:00Z' }
    )).toBe(true);
  });

  it('returns false when server updated_at is newer than local', () => {
    expect(isLocalDataNewer(
      { updated_at: '2025-01-01T00:00:00Z', synced_at: '2025-01-01T00:00:00Z' },
      { updated_at: '2025-01-02T00:00:00Z' }
    )).toBe(false);
  });

  it('returns false when timestamps are equal', () => {
    expect(isLocalDataNewer(
      { updated_at: '2025-01-01T00:00:00Z', synced_at: '2025-01-01T00:00:00Z' },
      { updated_at: '2025-01-01T00:00:00Z' }
    )).toBe(false);
  });

  it('returns false when serverData is null', () => {
    expect(isLocalDataNewer(
      { updated_at: '2025-01-01T00:00:00Z', synced_at: '2025-01-01T00:00:00Z' },
      null
    )).toBe(false);
  });

  it('returns false when serverData is undefined', () => {
    expect(isLocalDataNewer(
      { updated_at: '2025-01-01T00:00:00Z', synced_at: '2025-01-01T00:00:00Z' },
      undefined
    )).toBe(false);
  });

  it('returns false when offlineData.updated_at is null', () => {
    expect(isLocalDataNewer(
      { updated_at: null, synced_at: '2025-01-01T00:00:00Z' },
      { updated_at: '2025-01-01T00:00:00Z' }
    )).toBe(false);
  });
});

describe('shouldPreserveLocalRecord', () => {
  it('returns false when localRecord is null', () => {
    expect(shouldPreserveLocalRecord(null)).toBe(false);
  });

  it('returns false when localRecord is undefined', () => {
    expect(shouldPreserveLocalRecord(undefined)).toBe(false);
  });

  it('returns true when synced_at is null (never synced)', () => {
    expect(shouldPreserveLocalRecord({ synced_at: null, updated_at: '2025-01-01T00:00:00Z' })).toBe(true);
  });

  it('returns true when synced_at is undefined', () => {
    expect(shouldPreserveLocalRecord({ updated_at: '2025-01-01T00:00:00Z' })).toBe(true);
  });

  it('returns true when updated_at is newer than synced_at by more than tolerance', () => {
    expect(shouldPreserveLocalRecord({
      synced_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z'
    })).toBe(true);
  });

  it('returns false when updated_at is only slightly ahead of synced_at (within tolerance)', () => {
    const synced = new Date('2025-01-01T12:00:00.000Z');
    const updated = new Date(synced.getTime() + 3_000); // 3s ahead
    expect(shouldPreserveLocalRecord({
      synced_at: synced.toISOString(),
      updated_at: updated.toISOString()
    })).toBe(false);
  });

  it('returns true when updated_at is ahead of synced_at by tolerance + 1ms (beyond tolerance)', () => {
    const synced = new Date('2025-01-01T12:00:00.000Z');
    const updated = new Date(synced.getTime() + SYNC_DRIFT_TOLERANCE_MS + 1);
    expect(shouldPreserveLocalRecord({
      synced_at: synced.toISOString(),
      updated_at: updated.toISOString()
    })).toBe(true);
  });

  it('returns false when updated_at equals synced_at', () => {
    expect(shouldPreserveLocalRecord({
      synced_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z'
    })).toBe(false);
  });

  it('returns true when updated_at is much older than synced_at (large negative drift = clock anomaly worth preserving)', () => {
    // Post-S31: |drift| > tolerance triggers preservation regardless of sign.
    expect(shouldPreserveLocalRecord({
      synced_at: '2025-01-02T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z'
    })).toBe(true);
  });

  it('returns false when synced_at is only slightly ahead of updated_at (within tolerance)', () => {
    const updated = new Date('2025-01-01T12:00:00.000Z');
    const synced = new Date(updated.getTime() + 3_000); // synced 3s ahead — server-anchored timestamp
    expect(shouldPreserveLocalRecord({
      synced_at: synced.toISOString(),
      updated_at: updated.toISOString()
    })).toBe(false);
  });

  it('returns false when updated_at is null but synced_at exists', () => {
    expect(shouldPreserveLocalRecord({
      synced_at: '2025-01-01T00:00:00Z',
      updated_at: null
    })).toBe(false);
  });
});

describe('drift tolerance boundary contract', () => {
  const baseSynced = '2025-01-01T12:00:00.000Z';
  const baseSyncedMs = new Date(baseSynced).getTime();

  it('drift exactly equal to tolerance is treated as synced (isLocalDataNewer)', () => {
    const updated = new Date(baseSyncedMs + SYNC_DRIFT_TOLERANCE_MS).toISOString();
    expect(isLocalDataNewer(
      { updated_at: updated, synced_at: baseSynced },
      { updated_at: baseSynced }
    )).toBe(false);
  });

  it('drift exactly equal to tolerance is treated as synced (shouldPreserveLocalRecord)', () => {
    const updated = new Date(baseSyncedMs + SYNC_DRIFT_TOLERANCE_MS).toISOString();
    expect(shouldPreserveLocalRecord({ synced_at: baseSynced, updated_at: updated })).toBe(false);
  });

  it('drift = tolerance + 1ms is treated as unsynced (both guards)', () => {
    const updated = new Date(baseSyncedMs + SYNC_DRIFT_TOLERANCE_MS + 1).toISOString();
    expect(isLocalDataNewer(
      { updated_at: updated, synced_at: baseSynced },
      { updated_at: baseSynced }
    )).toBe(true);
    expect(shouldPreserveLocalRecord({ synced_at: baseSynced, updated_at: updated })).toBe(true);
  });

  it('drift = tolerance - 1ms is treated as synced (both guards)', () => {
    const updated = new Date(baseSyncedMs + SYNC_DRIFT_TOLERANCE_MS - 1).toISOString();
    expect(isLocalDataNewer(
      { updated_at: updated, synced_at: baseSynced },
      { updated_at: baseSynced }
    )).toBe(false);
    expect(shouldPreserveLocalRecord({ synced_at: baseSynced, updated_at: updated })).toBe(false);
  });
});
