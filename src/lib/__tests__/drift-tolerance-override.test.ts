import { describe, it, expect } from 'vitest';
import {
  exceedsDriftTolerance,
  isUpdatedAheadOfSync,
  SYNC_DRIFT_TOLERANCE_MS,
} from '../local-data-guards';

/**
 * P4 — `toleranceMs` override on the drift helpers.
 *
 * Production callers omit the third arg and inherit the 30s constant.
 * Tests pass `0` to assert strict-ordering semantics without `vi.mock`-ing
 * the whole module.
 */

describe('P4 — drift tolerance override', () => {
  it('isUpdatedAheadOfSync: default tolerance treats 29s drift as synced', () => {
    expect(isUpdatedAheadOfSync(29_000, 0)).toBe(false);
    expect(isUpdatedAheadOfSync(31_000, 0)).toBe(true);
  });

  it('isUpdatedAheadOfSync: tolerance=0 flags any positive drift as unsynced', () => {
    expect(isUpdatedAheadOfSync(1, 0, 0)).toBe(true);
    expect(isUpdatedAheadOfSync(0, 0, 0)).toBe(false);
    expect(isUpdatedAheadOfSync(0, 1, 0)).toBe(false); // local older — never unsynced
  });

  it('isUpdatedAheadOfSync: custom 5_000ms tolerance', () => {
    expect(isUpdatedAheadOfSync(5_000, 0, 5_000)).toBe(false);
    expect(isUpdatedAheadOfSync(5_001, 0, 5_000)).toBe(true);
  });

  it('exceedsDriftTolerance: default tolerance', () => {
    expect(exceedsDriftTolerance(0, 30_000)).toBe(false);
    expect(exceedsDriftTolerance(0, 30_001)).toBe(true);
  });

  it('exceedsDriftTolerance: tolerance=0 surfaces any difference', () => {
    expect(exceedsDriftTolerance(0, 1, 0)).toBe(true);
    expect(exceedsDriftTolerance(0, 0, 0)).toBe(false);
  });

  it('SYNC_DRIFT_TOLERANCE_MS export remains the documented 30s', () => {
    expect(SYNC_DRIFT_TOLERANCE_MS).toBe(30_000);
  });
});
