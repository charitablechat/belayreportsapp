/**
 * Mode 9F — Tests for the layer-breaker close subscriber contract.
 *
 * The Mode 8A layer breaker auto-clears after its cooldown
 * (60s/120s/240s exponential). Mode 9F adds a subscriber list that
 * `useAutoSync` registers a callback against; the callback fires once
 * per cooldown-expiry transition so the autosync engine can attempt an
 * immediate drain instead of waiting up to 30s for the next periodic
 * tick.
 *
 * For the offline→online recovery scenario this halves typical
 * recovery latency: the breaker tripped at T=0 clears at T=60s; without
 * 9F the next drain attempt happens 0-30s later (the active periodic
 * interval); with 9F the next drain attempt happens at T≈60s+0.
 *
 * See `mode-9-structural-force-drain-diagnostic.md` for the full
 * rationale.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isIdbLayerBreakerOpen,
  subscribeToLayerBreakerClose,
  __test_only__setLayerBreakerStateForTests,
  __test_only__resetLayerBreakerForTests,
  __test_only__LAYER_BREAKER_BASE_COOLDOWN_MS,
  __test_only__getLayerBreakerCloseSubscriberCount,
  __test_only__recordLayerBoundaryTimeoutForTests,
  __test_only__recordLayerBoundarySuccessForTests,
} from '../offline-storage';

describe('Mode 9F — layer breaker close-subscriber contract', () => {
  beforeEach(() => {
    __test_only__resetLayerBreakerForTests();
  });

  describe('subscribe / unsubscribe lifecycle', () => {
    it('subscribe registers the callback and returns an unsubscribe function', () => {
      expect(__test_only__getLayerBreakerCloseSubscriberCount()).toBe(0);
      const unsub = subscribeToLayerBreakerClose(() => {});
      expect(__test_only__getLayerBreakerCloseSubscriberCount()).toBe(1);
      expect(typeof unsub).toBe('function');
      unsub();
      expect(__test_only__getLayerBreakerCloseSubscriberCount()).toBe(0);
    });

    it('unsubscribe is idempotent — calling twice does not throw or double-decrement', () => {
      const unsub = subscribeToLayerBreakerClose(() => {});
      unsub();
      expect(__test_only__getLayerBreakerCloseSubscriberCount()).toBe(0);
      expect(() => unsub()).not.toThrow();
      expect(__test_only__getLayerBreakerCloseSubscriberCount()).toBe(0);
    });

    it('multiple subscriptions are tracked independently', () => {
      const u1 = subscribeToLayerBreakerClose(() => {});
      const u2 = subscribeToLayerBreakerClose(() => {});
      const u3 = subscribeToLayerBreakerClose(() => {});
      expect(__test_only__getLayerBreakerCloseSubscriberCount()).toBe(3);
      u2();
      expect(__test_only__getLayerBreakerCloseSubscriberCount()).toBe(2);
      u1();
      u3();
      expect(__test_only__getLayerBreakerCloseSubscriberCount()).toBe(0);
    });
  });

  describe('emission gating — fires ONLY on cooldown-expiry transition', () => {
    it('does NOT fire while breaker is closed (counter < threshold)', () => {
      const cb = vi.fn();
      subscribeToLayerBreakerClose(cb);
      // Two timeouts — below the threshold of 3, breaker stays closed.
      __test_only__recordLayerBoundaryTimeoutForTests();
      __test_only__recordLayerBoundaryTimeoutForTests();
      expect(cb).not.toHaveBeenCalled();
    });

    it('does NOT fire on the trip event (open transition)', () => {
      const cb = vi.fn();
      subscribeToLayerBreakerClose(cb);
      __test_only__recordLayerBoundaryTimeoutForTests();
      __test_only__recordLayerBoundaryTimeoutForTests();
      __test_only__recordLayerBoundaryTimeoutForTests();
      // Breaker just tripped — this is open transition, not close.
      expect(cb).not.toHaveBeenCalled();
    });

    it('does NOT fire when isIdbLayerBreakerOpen is called WITHIN the cooldown window', () => {
      const cb = vi.fn();
      subscribeToLayerBreakerClose(cb);
      const trippedAt = 1_000_000;
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 3,
        trippedAt,
        resetCount: 0,
      });
      // Probe partway into the cooldown — still open, no transition.
      const halfway = trippedAt + __test_only__LAYER_BREAKER_BASE_COOLDOWN_MS / 2;
      expect(isIdbLayerBreakerOpen(halfway)).toBe(true);
      expect(cb).not.toHaveBeenCalled();
    });

    it('FIRES exactly once when cooldown expires (true → false transition)', () => {
      const cb = vi.fn();
      subscribeToLayerBreakerClose(cb);
      const trippedAt = 1_000_000;
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 3,
        trippedAt,
        resetCount: 0,
      });
      const past = trippedAt + __test_only__LAYER_BREAKER_BASE_COOLDOWN_MS + 1;
      expect(isIdbLayerBreakerOpen(past)).toBe(false);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('does NOT re-fire on subsequent isIdbLayerBreakerOpen calls after the transition', () => {
      const cb = vi.fn();
      subscribeToLayerBreakerClose(cb);
      const trippedAt = 1_000_000;
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 3,
        trippedAt,
        resetCount: 0,
      });
      const past = trippedAt + __test_only__LAYER_BREAKER_BASE_COOLDOWN_MS + 1;
      isIdbLayerBreakerOpen(past);
      expect(cb).toHaveBeenCalledTimes(1);
      // Probe several more times — already-cleared, no further emissions.
      isIdbLayerBreakerOpen(past + 1000);
      isIdbLayerBreakerOpen(past + 5000);
      isIdbLayerBreakerOpen(past + 60000);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('FIRES again on a SECOND trip + cooldown-expiry cycle (idempotent across cycles)', () => {
      const cb = vi.fn();
      subscribeToLayerBreakerClose(cb);
      // Cycle 1: trip + clear.
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 3,
        trippedAt: 1_000_000,
        resetCount: 0,
      });
      isIdbLayerBreakerOpen(1_000_000 + __test_only__LAYER_BREAKER_BASE_COOLDOWN_MS + 1);
      expect(cb).toHaveBeenCalledTimes(1);
      // Cycle 2: re-trip (resetCount has incremented to 1, so cooldown is 120s).
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 3,
        trippedAt: 2_000_000,
        // Don't override resetCount — it is now 1 from the prior expiry.
      });
      isIdbLayerBreakerOpen(2_000_000 + 120_001);
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it('does NOT fire on success-recovery path (recordLayerBoundarySuccess)', () => {
      const cb = vi.fn();
      subscribeToLayerBreakerClose(cb);
      // Set up: 2 timeouts (below threshold), then success.
      __test_only__recordLayerBoundaryTimeoutForTests();
      __test_only__recordLayerBoundaryTimeoutForTests();
      __test_only__recordLayerBoundarySuccessForTests();
      // Subscriber only fires on cooldown-expiry, not on the success path.
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('multi-subscriber + error isolation', () => {
    it('all registered subscribers are invoked on a single transition', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      const cb3 = vi.fn();
      subscribeToLayerBreakerClose(cb1);
      subscribeToLayerBreakerClose(cb2);
      subscribeToLayerBreakerClose(cb3);
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 3,
        trippedAt: 1_000_000,
        resetCount: 0,
      });
      isIdbLayerBreakerOpen(1_000_000 + __test_only__LAYER_BREAKER_BASE_COOLDOWN_MS + 1);
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
      expect(cb3).toHaveBeenCalledTimes(1);
    });

    it('a throwing subscriber does NOT prevent other subscribers from firing', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn(() => { throw new Error('boom'); });
      const cb3 = vi.fn();
      subscribeToLayerBreakerClose(cb1);
      subscribeToLayerBreakerClose(cb2);
      subscribeToLayerBreakerClose(cb3);
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 3,
        trippedAt: 1_000_000,
        resetCount: 0,
      });
      const result = isIdbLayerBreakerOpen(1_000_000 + __test_only__LAYER_BREAKER_BASE_COOLDOWN_MS + 1);
      expect(result).toBe(false);
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
      expect(cb3).toHaveBeenCalledTimes(1);
    });

    it('a subscriber that synchronously unsubscribes itself does not corrupt iteration', () => {
      const cb1 = vi.fn();
      let unsub2: (() => void) | null = null;
      const cb2 = vi.fn(() => unsub2?.());
      const cb3 = vi.fn();
      subscribeToLayerBreakerClose(cb1);
      unsub2 = subscribeToLayerBreakerClose(cb2);
      subscribeToLayerBreakerClose(cb3);
      __test_only__setLayerBreakerStateForTests({
        consecutiveTimeouts: 3,
        trippedAt: 1_000_000,
        resetCount: 0,
      });
      isIdbLayerBreakerOpen(1_000_000 + __test_only__LAYER_BREAKER_BASE_COOLDOWN_MS + 1);
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
      expect(cb3).toHaveBeenCalledTimes(1);
      expect(__test_only__getLayerBreakerCloseSubscriberCount()).toBe(2);
    });
  });

  describe('cleanup integration', () => {
    it('__test_only__resetLayerBreakerForTests clears all subscribers (test-only contract)', () => {
      subscribeToLayerBreakerClose(() => {});
      subscribeToLayerBreakerClose(() => {});
      expect(__test_only__getLayerBreakerCloseSubscriberCount()).toBe(2);
      __test_only__resetLayerBreakerForTests();
      expect(__test_only__getLayerBreakerCloseSubscriberCount()).toBe(0);
    });
  });
});
