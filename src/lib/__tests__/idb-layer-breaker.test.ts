/**
 * Mode 8A — Tests for the layer-level IDB queue-stuck breaker.
 *
 * Background: PR #106's CI run showed that even with Mode 7A's 32-40s
 * boundary budgets, the underlying IDBOpenDBRequest queue can stay wedged
 * for 4+ minutes after a `setOffline(true→false)` toggle. Boundary timeouts
 * pile on a queue that has no spec-level abort, so the wedge can only
 * drain naturally as the browser frees in-flight requests.
 *
 * The per-store circuit breaker (keyed by `inspections | trainings |
 * daily_assessments | photos | global`) is too dilute to bound this:
 * ~60 of ~70 boundary call sites default to `'global'`, so the dominant
 * bucket trips fast and protects most callers, but the autosync drain on
 * `'inspections'/'trainings'/'daily_assessments'` (each in its own bucket)
 * still piles new opens onto the wedged queue while waiting for its own
 * bucket to hit threshold.
 *
 * Mode 8A adds a layer-level counter that increments on every boundary
 * timeout (any store) and trips a global "idb-queue-stuck" fast-fail
 * window once `LAYER_BREAKER_THRESHOLD` consecutive timeouts are
 * observed. While this layer breaker is open, all three boundary helpers
 * fast-fail at the top of the function — no new `getDB()` is called, no
 * new `openDB` is queued, the wedged queue gets a chance to drain
 * naturally before more callers pile on.
 *
 * After the cooldown expires, the breaker auto-clears (with `resetCount`
 * incrementing for exponential backoff on the next trip) and the next
 * boundary call probes the queue naturally.
 *
 * See `mode-8-structural-idb-wedge-diagnostic.md` for the full rationale.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isIdbLayerBreakerOpen,
  __test_only__setLayerBreakerStateForTests,
  __test_only__resetLayerBreakerForTests,
  __test_only__getLayerBreakerStateForTests,
  __test_only__LAYER_BREAKER_THRESHOLD,
  __test_only__LAYER_BREAKER_BASE_COOLDOWN_MS,
  __test_only__LAYER_BREAKER_MAX_COOLDOWN_MS,
  __test_only__recordLayerBoundaryTimeoutForTests,
  __test_only__recordLayerBoundarySuccessForTests,
} from '../offline-storage';

describe('Mode 8A — layer-level queue-stuck breaker contract', () => {
  beforeEach(() => {
    __test_only__resetLayerBreakerForTests();
  });

  describe('static contract — pinned constants', () => {
    it('threshold is 3 (three consecutive boundary timeouts before tripping)', () => {
      expect(__test_only__LAYER_BREAKER_THRESHOLD).toBe(3);
    });

    it('base cooldown is 60s (1 minute)', () => {
      expect(__test_only__LAYER_BREAKER_BASE_COOLDOWN_MS).toBe(60_000);
    });

    it('max cooldown ceiling is 240s (4 minutes) for exponential backoff', () => {
      expect(__test_only__LAYER_BREAKER_MAX_COOLDOWN_MS).toBe(240_000);
    });

    it('exponential backoff respects the 4-minute ceiling — 60s → 120s → 240s → 240s …', () => {
      // base × 2^0 = 60s, ×2 = 120s, ×2 = 240s, ×2 capped at 240s.
      // Verify by reading cooldownMs via the inspection helper at each reset
      // count, since `getLayerBreakerCooldownMs` is module-private.
      __test_only__setLayerBreakerStateForTests({ resetCount: 0 });
      expect(__test_only__getLayerBreakerStateForTests().cooldownMs).toBe(60_000);
      __test_only__setLayerBreakerStateForTests({ resetCount: 1 });
      expect(__test_only__getLayerBreakerStateForTests().cooldownMs).toBe(120_000);
      __test_only__setLayerBreakerStateForTests({ resetCount: 2 });
      expect(__test_only__getLayerBreakerStateForTests().cooldownMs).toBe(240_000);
      __test_only__setLayerBreakerStateForTests({ resetCount: 3 });
      expect(__test_only__getLayerBreakerStateForTests().cooldownMs).toBe(240_000);
      __test_only__setLayerBreakerStateForTests({ resetCount: 8 });
      expect(__test_only__getLayerBreakerStateForTests().cooldownMs).toBe(240_000);
    });
  });

  describe('isIdbLayerBreakerOpen — fresh module state', () => {
    it('returns false when no timeout has ever been recorded', () => {
      expect(isIdbLayerBreakerOpen()).toBe(false);
    });

    it('returns false after a single isolated timeout (1 < threshold 3)', () => {
      __test_only__recordLayerBoundaryTimeoutForTests();
      expect(__test_only__getLayerBreakerStateForTests().consecutiveTimeouts).toBe(1);
      expect(isIdbLayerBreakerOpen()).toBe(false);
    });

    it('returns false after two consecutive timeouts (2 < threshold 3)', () => {
      __test_only__recordLayerBoundaryTimeoutForTests();
      __test_only__recordLayerBoundaryTimeoutForTests();
      expect(__test_only__getLayerBreakerStateForTests().consecutiveTimeouts).toBe(2);
      expect(isIdbLayerBreakerOpen()).toBe(false);
    });

    it('returns true exactly at the third consecutive timeout (=== threshold)', () => {
      __test_only__recordLayerBoundaryTimeoutForTests();
      __test_only__recordLayerBoundaryTimeoutForTests();
      __test_only__recordLayerBoundaryTimeoutForTests();
      expect(__test_only__getLayerBreakerStateForTests().consecutiveTimeouts).toBe(3);
      expect(isIdbLayerBreakerOpen()).toBe(true);
    });

    it('a fourth timeout while already-tripped does not move `trippedAt` (preserves the original window)', () => {
      __test_only__recordLayerBoundaryTimeoutForTests();
      __test_only__recordLayerBoundaryTimeoutForTests();
      __test_only__recordLayerBoundaryTimeoutForTests();
      const trippedAtBefore = __test_only__getLayerBreakerStateForTests().trippedAt;
      __test_only__recordLayerBoundaryTimeoutForTests();
      const trippedAtAfter = __test_only__getLayerBreakerStateForTests().trippedAt;
      expect(trippedAtAfter).toBe(trippedAtBefore);
      expect(__test_only__getLayerBreakerStateForTests().consecutiveTimeouts).toBe(4);
    });
  });

  describe('isIdbLayerBreakerOpen — cooldown semantics', () => {
    it('returns true while now is inside the cooldown window', () => {
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 3,
        trippedAt: 1_000_000,
        resetCount: 0,
      });
      // 30s after trip — well within 60s base cooldown.
      expect(isIdbLayerBreakerOpen(1_000_000 + 30_000)).toBe(true);
    });

    it('returns true at the exact final ms of the cooldown window (strict-less-than boundary)', () => {
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 3,
        trippedAt: 1_000_000,
        resetCount: 0,
      });
      // `now - trippedAt` must be strictly greater than cooldown for the
      // breaker to clear, so cooldown - 1 stays open.
      expect(isIdbLayerBreakerOpen(1_000_000 + 60_000 - 1)).toBe(true);
    });

    it('clears the breaker when now is past the cooldown window', () => {
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 3,
        trippedAt: 1_000_000,
        resetCount: 0,
      });
      // 60s + 1ms after trip — cooldown elapsed.
      expect(isIdbLayerBreakerOpen(1_000_000 + 60_001)).toBe(false);
      // After clearing, internal state is reset and `resetCount` escalates.
      const state = __test_only__getLayerBreakerStateForTests();
      expect(state.consecutiveTimeouts).toBe(0);
      expect(state.trippedAt).toBe(null);
      expect(state.resetCount).toBe(1);
    });

    it('honours the longer cooldown after the second trip (exponential backoff)', () => {
      // After clearing once, resetCount=1 means cooldown is 120s.
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 3,
        trippedAt: 2_000_000,
        resetCount: 1,
      });
      // Inside 120s cooldown.
      expect(isIdbLayerBreakerOpen(2_000_000 + 90_000)).toBe(true);
      // Outside 120s cooldown.
      expect(isIdbLayerBreakerOpen(2_000_000 + 120_001)).toBe(false);
    });

    it('caps cooldown at the 240s ceiling once `resetCount` is high', () => {
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 3,
        trippedAt: 5_000_000,
        resetCount: 10, // base × 2^10 ≫ ceiling
      });
      // Just inside 240s ceiling.
      expect(isIdbLayerBreakerOpen(5_000_000 + 239_000)).toBe(true);
      // Just past 240s ceiling — cooldown elapsed.
      expect(isIdbLayerBreakerOpen(5_000_000 + 240_001)).toBe(false);
    });
  });

  describe('recordLayerBoundarySuccess — recovery', () => {
    it('clears the consecutive-timeout counter mid-cycle', () => {
      __test_only__recordLayerBoundaryTimeoutForTests();
      __test_only__recordLayerBoundaryTimeoutForTests();
      expect(__test_only__getLayerBreakerStateForTests().consecutiveTimeouts).toBe(2);
      __test_only__recordLayerBoundarySuccessForTests();
      expect(__test_only__getLayerBreakerStateForTests().consecutiveTimeouts).toBe(0);
      expect(isIdbLayerBreakerOpen()).toBe(false);
    });

    it('clears `trippedAt` and resets backoff so subsequent trips start fresh', () => {
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 3,
        trippedAt: 1_000_000,
        resetCount: 2,
      });
      __test_only__recordLayerBoundarySuccessForTests();
      const state = __test_only__getLayerBreakerStateForTests();
      expect(state.consecutiveTimeouts).toBe(0);
      expect(state.trippedAt).toBe(null);
      expect(state.resetCount).toBe(0);
    });

    it('is a no-op when state is already clean (no needless writes)', () => {
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 0,
        trippedAt: null,
        resetCount: 0,
      });
      __test_only__recordLayerBoundarySuccessForTests();
      const state = __test_only__getLayerBreakerStateForTests();
      expect(state.consecutiveTimeouts).toBe(0);
      expect(state.trippedAt).toBe(null);
      expect(state.resetCount).toBe(0);
    });

    it('resets the breaker between trip cycles so a new wedge needs a fresh 3 timeouts', () => {
      // Trip once.
      __test_only__recordLayerBoundaryTimeoutForTests();
      __test_only__recordLayerBoundaryTimeoutForTests();
      __test_only__recordLayerBoundaryTimeoutForTests();
      expect(isIdbLayerBreakerOpen()).toBe(true);
      // Recovery clears.
      __test_only__recordLayerBoundarySuccessForTests();
      expect(isIdbLayerBreakerOpen()).toBe(false);
      // Two timeouts no longer enough — counter restarts at 0 after success.
      __test_only__recordLayerBoundaryTimeoutForTests();
      __test_only__recordLayerBoundaryTimeoutForTests();
      expect(isIdbLayerBreakerOpen()).toBe(false);
      // Third timeout trips again.
      __test_only__recordLayerBoundaryTimeoutForTests();
      expect(isIdbLayerBreakerOpen()).toBe(true);
    });
  });

  describe('design rationale — pinned invariants', () => {
    it('threshold matches the per-store breaker threshold (3) so behaviour is symmetric', () => {
      // Per-store CIRCUIT_BREAKER_THRESHOLD is 3 (offline-storage.ts:379).
      // Layer breaker uses the same value so users see consistent fast-fail
      // semantics regardless of which breaker tripped first.
      expect(__test_only__LAYER_BREAKER_THRESHOLD).toBe(3);
    });

    it('base cooldown matches per-store breaker base (60s) for symmetry', () => {
      // Per-store BASE_CIRCUIT_BREAKER_RESET_TIME is 60_000.
      expect(__test_only__LAYER_BREAKER_BASE_COOLDOWN_MS).toBe(60_000);
    });

    it('max cooldown is shorter than per-store ceiling (240s vs 300s) — layer breaker is more aggressive about retrying because the wedge clears naturally', () => {
      // Per-store MAX_CIRCUIT_BREAKER_RESET_TIME is 300_000.
      // Layer breaker ceiling is intentionally lower: the underlying queue
      // wedge clears on its own as the browser drains in-flight requests
      // (typically 2-5 min in CI), so we want to attempt a fresh probe
      // sooner rather than later.
      expect(__test_only__LAYER_BREAKER_MAX_COOLDOWN_MS).toBe(240_000);
      expect(__test_only__LAYER_BREAKER_MAX_COOLDOWN_MS).toBeLessThan(300_000);
    });
  });
});
