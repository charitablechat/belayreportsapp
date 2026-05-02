/**
 * Mode 9A — Tests for the synchronous `dbPromise` reset gating predicate
 * (`shouldResetDbOnOnline`).
 *
 * The Mode 9A reset is symmetric with the existing `cached-auth.ts`
 * bfcache `pageshow` handler (`softInvalidateForBfcacheRestore`). On the
 * `online` event we close + null `dbPromise` ONLY when there is positive
 * evidence the IDB queue may be wedged: recent boundary activity AND
 * (breaker open OR at least one timeout has accumulated since the last
 * success). Healthy reconnects on a steady-state app (no recent boundary
 * activity, or all-success recent activity) skip the reset entirely so
 * we don't churn `dbPromise` for users on stable networks.
 *
 * IMPORTANT CAVEAT: per the W3C IndexedDB spec, this reset cannot abort
 * an in-flight `IDBOpenDBRequest`; it only frees OUR reference so the
 * subsequent `getDB()` warm-up (Mode 8B) starts a fresh request rather
 * than awaiting the wedged one. Composed with Mode 8A's layer breaker
 * this is a slight recovery-curve win without growing net queue depth
 * (the breaker bounds the rate at which new opens are queued).
 *
 * See `mode-9-structural-force-drain-diagnostic.md` for the full
 * rationale + risk model.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldResetDbOnOnline,
  __test_only__setLayerBreakerStateForTests,
  __test_only__resetLayerBreakerForTests,
  __test_only__recordLayerBoundaryTimeoutForTests,
  __test_only__recordLayerBoundarySuccessForTests,
  __test_only__getLastDbActivityAt,
} from '../offline-storage';

describe('Mode 9A — shouldResetDbOnOnline gating predicate', () => {
  beforeEach(() => {
    __test_only__resetLayerBreakerForTests();
  });

  describe('healthy-session skip — fresh page load / steady state', () => {
    it('returns false on a fresh module (no IDB activity ever)', () => {
      // Default state: lastDbActivityAt=0, breaker closed, no timeouts.
      // This is exactly the shape of a freshly-loaded tab firing `online`.
      expect(shouldResetDbOnOnline(Date.now())).toBe(false);
    });

    it('returns false when the only recent activity was a success and breaker is clean', () => {
      __test_only__recordLayerBoundarySuccessForTests();
      // Activity timestamp is now `recent`, but breaker is closed and
      // consecutiveTimeouts is 0 — no wedge evidence.
      expect(shouldResetDbOnOnline(Date.now())).toBe(false);
    });

    it('returns false when activity is stale (>5s ago) even with timeouts present', () => {
      const now = 1_000_000;
      // Stamp activity 6s ago, with one accumulated timeout.
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 1,
        lastDbActivityAt: now - 6_000,
      });
      expect(shouldResetDbOnOnline(now)).toBe(false);
    });

    it('returns false when breaker is closed AND consecutiveTimeouts is 0 (even if activity is recent)', () => {
      const now = 1_000_000;
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 0,
        trippedAt: null,
        lastDbActivityAt: now - 100,
      });
      expect(shouldResetDbOnOnline(now)).toBe(false);
    });
  });

  describe('wedge-evidence reset — fires when activity is recent AND breaker/counter shows wedge', () => {
    it('returns true when breaker is OPEN and activity is recent', () => {
      const now = 1_000_000;
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 3,
        trippedAt: now - 1_000, // tripped 1s ago, well within 60s cooldown
        resetCount: 0,
        lastDbActivityAt: now - 500,
      });
      expect(shouldResetDbOnOnline(now)).toBe(true);
    });

    it('returns true when consecutiveTimeouts is 1 (just below threshold) and activity is recent', () => {
      const now = 1_000_000;
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 1,
        trippedAt: null,
        lastDbActivityAt: now - 100,
      });
      expect(shouldResetDbOnOnline(now)).toBe(true);
    });

    it('returns true when consecutiveTimeouts is 2 (just below threshold) and activity is recent', () => {
      const now = 1_000_000;
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 2,
        trippedAt: null,
        lastDbActivityAt: now - 100,
      });
      expect(shouldResetDbOnOnline(now)).toBe(true);
    });

    it('treats a recent timeout (via recordLayerBoundaryTimeout) as recent activity AND wedge evidence', () => {
      // End-to-end: bump the counter via the production helper instead of
      // setter shortcut — proves `recordLayerBoundaryTimeout` increments
      // both `lastDbActivityAt` and `consecutiveTimeouts`.
      __test_only__recordLayerBoundaryTimeoutForTests();
      expect(__test_only__getLastDbActivityAt()).toBeGreaterThan(0);
      expect(shouldResetDbOnOnline(Date.now())).toBe(true);
    });
  });

  describe('configurable activity window', () => {
    it('honors a custom recentActivityWindowMs', () => {
      const now = 1_000_000;
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 1,
        lastDbActivityAt: now - 8_000, // 8s ago
      });
      // Default 5s window → false.
      expect(shouldResetDbOnOnline(now)).toBe(false);
      // Widened to 15s window → true.
      expect(shouldResetDbOnOnline(now, { recentActivityWindowMs: 15_000 })).toBe(true);
    });
  });

  describe('cooldown-expired interaction with isIdbLayerBreakerOpen', () => {
    it('returns true on the boundary moment where breaker is still open AND activity recent', () => {
      const trippedAt = 1_000_000;
      const now = trippedAt + 30_000; // 30s into the 60s base cooldown
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 3,
        trippedAt,
        resetCount: 0,
        lastDbActivityAt: trippedAt + 1, // just after trip
      });
      // Activity is 30s ago — outside the 5s default window → false.
      expect(shouldResetDbOnOnline(now)).toBe(false);
      // But with a 60s window it would be true (breaker still open).
      expect(shouldResetDbOnOnline(now, { recentActivityWindowMs: 60_000 })).toBe(true);
    });

    it('returns false after cooldown expiry IF consecutiveTimeouts is reset to 0 by the expiry path', () => {
      // Simulating the post-expiry steady state: breaker auto-cleared
      // (sets trippedAt=null, consecutiveTimeouts=0), no wedge evidence
      // remaining — the next `online` tick should NOT thrash dbPromise.
      const now = 1_000_000;
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 0,
        trippedAt: null,
        resetCount: 1, // bumped by the prior expiry
        lastDbActivityAt: now - 100,
      });
      expect(shouldResetDbOnOnline(now)).toBe(false);
    });
  });

  describe('lastDbActivityAt tracking', () => {
    it('recordLayerBoundaryTimeout updates lastDbActivityAt', () => {
      const before = __test_only__getLastDbActivityAt();
      __test_only__recordLayerBoundaryTimeoutForTests();
      const after = __test_only__getLastDbActivityAt();
      expect(after).toBeGreaterThan(before);
    });

    it('recordLayerBoundarySuccess updates lastDbActivityAt', () => {
      const before = __test_only__getLastDbActivityAt();
      __test_only__recordLayerBoundarySuccessForTests();
      const after = __test_only__getLastDbActivityAt();
      expect(after).toBeGreaterThan(before);
    });

    it('reset returns lastDbActivityAt to 0', () => {
      __test_only__recordLayerBoundarySuccessForTests();
      expect(__test_only__getLastDbActivityAt()).toBeGreaterThan(0);
      __test_only__resetLayerBreakerForTests();
      expect(__test_only__getLastDbActivityAt()).toBe(0);
    });
  });
});
