/**
 * Mode 7B — Tests for atomic-sync's outer fetch-`Promise.race` budget.
 *
 * Background: `syncInspections`, `syncTrainings`, and `syncDailyAssessments`
 * each wrap their `getUnsynced*(user.id)` call in an outer `Promise.race`
 * against a hard-coded 15s timeout. Pre-Mode-6, the inner boundary fired
 * at 5-10s (steady-state tier ceilings) — the outer race was a safety net
 * above the inner. Mode 6 widened the inner boundary to 30s (and Mode 7A
 * widened it further to 40s for `batch` tier) during the post-online
 * recovery grace window — but the outer race stayed at 15s, so the outer
 * fired BEFORE the inner had time to ride out the wedge.
 *
 * Mode 7B fix: the outer race budget tracks
 * `selectAtomicSyncFetchOuterTimeout()`, which returns 15s steady-state
 * but lifts to 45s during the post-online recovery grace window. 45s sits
 * above the inner `batch` (40s) and `write` (32s) tier ceilings under
 * Mode 7A's 4× multiplier, restoring the "outer = safety net above inner"
 * invariant.
 *
 * The implementation is a pure function over `isInPostOnlineRecoveryGrace()`,
 * so we can test it deterministically by stamping the recovery timestamp
 * via `setLastOnlineRecoveryAtForTests`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  __test_only__selectAtomicSyncFetchOuterTimeout,
  __test_only__ATOMIC_SYNC_FETCH_OUTER_TIMEOUT_MS,
  __test_only__ATOMIC_SYNC_FETCH_OUTER_TIMEOUT_GRACE_MS,
} from '../atomic-sync-manager';
import { setLastOnlineRecoveryAtForTests } from '../offline-storage';

describe('selectAtomicSyncFetchOuterTimeout — Mode 7B grace-aware outer race budget', () => {
  beforeEach(() => {
    // Reset the grace stamp so each test starts from a known baseline.
    setLastOnlineRecoveryAtForTests(0);
  });

  it('returns 15_000ms steady-state when no `online` event has fired', () => {
    // Pre-Mode-7B baseline: 15s safety net for very slow mobile networks.
    expect(__test_only__selectAtomicSyncFetchOuterTimeout()).toBe(15_000);
  });

  it('returns 45_000ms during the post-online recovery grace window', () => {
    // Mode 7B: outer budget tracks the inner widening so the safety net
    // sits above the per-op ceiling instead of cutting it off.
    setLastOnlineRecoveryAtForTests(Date.now());
    expect(__test_only__selectAtomicSyncFetchOuterTimeout()).toBe(45_000);
  });

  it('returns 15_000ms once the grace window has expired (90s after `online`)', () => {
    // The grace window expires at 90s post-`online` (Mode 7A calibration);
    // outside it, the outer race reverts to its steady-state value.
    setLastOnlineRecoveryAtForTests(Date.now() - 90_001);
    expect(__test_only__selectAtomicSyncFetchOuterTimeout()).toBe(15_000);
  });

  it('exposes the steady-state and grace-window constants for cross-checking with the inner boundary', () => {
    // These values are consumed by `selectAtomicSyncFetchOuterTimeout` and
    // must stay above the inner `batch`/`write` tier ceilings under Mode
    // 7A's 4× multiplier (40s/32s respectively). If a future change drops
    // the outer below the inner, this test surfaces the invariant break.
    expect(__test_only__ATOMIC_SYNC_FETCH_OUTER_TIMEOUT_MS).toBe(15_000);
    expect(__test_only__ATOMIC_SYNC_FETCH_OUTER_TIMEOUT_GRACE_MS).toBe(45_000);

    // Inner boundary ceilings under Mode 7A's 4× multiplier:
    //   light:  5_000 × 4 = 20_000
    //   batch: 10_000 × 4 = 40_000
    //   write:  8_000 × 4 = 32_000
    //   heavy: 15_000 × 4 = 60_000
    // The outer race only needs to stay above the tiers actually used by
    // the three drain pre-flights (which use the boundary's default
    // OPERATION_TIMEOUT, i.e. the `light` 5_000 case). 45_000 > 20_000 ✓.
    // It also stays above `batch` (40_000) and `write` (32_000), so any
    // future tier reassignment of the drain reads stays safe.
    expect(__test_only__ATOMIC_SYNC_FETCH_OUTER_TIMEOUT_GRACE_MS).toBeGreaterThan(40_000);
    expect(__test_only__ATOMIC_SYNC_FETCH_OUTER_TIMEOUT_GRACE_MS).toBeGreaterThan(32_000);
    expect(__test_only__ATOMIC_SYNC_FETCH_OUTER_TIMEOUT_GRACE_MS).toBeGreaterThan(20_000);
  });

  it('selector is a pure read of the recovery predicate — toggles in lock-step with grace state', () => {
    // No event: outside grace → steady-state.
    expect(__test_only__selectAtomicSyncFetchOuterTimeout()).toBe(15_000);

    // Stamp now: inside grace → grace-window value.
    setLastOnlineRecoveryAtForTests(Date.now());
    expect(__test_only__selectAtomicSyncFetchOuterTimeout()).toBe(45_000);

    // Move stamp backwards past expiry → back to steady-state.
    setLastOnlineRecoveryAtForTests(Date.now() - 90_001);
    expect(__test_only__selectAtomicSyncFetchOuterTimeout()).toBe(15_000);

    // Stamp again → back to grace-window value.
    setLastOnlineRecoveryAtForTests(Date.now());
    expect(__test_only__selectAtomicSyncFetchOuterTimeout()).toBe(45_000);
  });

  it('is independent of system clock skew — does not consult any external time source beyond Date.now()', () => {
    // Stamping a time strictly in the future (clock-skewed device) keeps
    // the predicate true (the time delta `now - stamp` is negative, still
    // < 90_000). Documents that the selector does not over-correct or
    // clamp negative values.
    setLastOnlineRecoveryAtForTests(Date.now() + 60_000);
    expect(__test_only__selectAtomicSyncFetchOuterTimeout()).toBe(45_000);
  });
});
