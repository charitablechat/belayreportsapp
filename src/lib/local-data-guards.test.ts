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

  it('returns true when updated_at is newer than synced_at by more than 5s tolerance', () => {
    expect(shouldPreserveLocalRecord({
      synced_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z'
    })).toBe(true);
  });

  it('returns false when updated_at is only slightly ahead of synced_at (clock skew within 5s tolerance)', () => {
    // 3 seconds ahead — within the 5-second clock-skew tolerance window
    expect(shouldPreserveLocalRecord({
      synced_at: '2025-01-01T12:00:00.000Z',
      updated_at: '2025-01-01T12:00:03.000Z'
    })).toBe(false);
  });

  it('returns true when updated_at is ahead of synced_at by exactly 6s (beyond tolerance)', () => {
    expect(shouldPreserveLocalRecord({
      synced_at: '2025-01-01T12:00:00.000Z',
      updated_at: '2025-01-01T12:00:06.000Z'
    })).toBe(true);
  });

  it('returns false when updated_at equals synced_at', () => {
    expect(shouldPreserveLocalRecord({
      synced_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z'
    })).toBe(false);
  });

  it('returns false when updated_at is older than synced_at', () => {
    expect(shouldPreserveLocalRecord({
      synced_at: '2025-01-02T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z'
    })).toBe(false);
  });

  it('returns false when updated_at is null but synced_at exists', () => {
    expect(shouldPreserveLocalRecord({
      synced_at: '2025-01-01T00:00:00Z',
      updated_at: null
    })).toBe(false);
  });
});
