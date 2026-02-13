import { describe, it, expect } from 'vitest';
import { isLocalDataNewer } from './local-data-guards';

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
