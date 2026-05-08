/**
 * Sprint 2 H: contract tests for `resetLayerBreakerOnUserActivity`.
 *
 * The function is the production-callable counterpart to the test-only
 * reset helper. It is wired into SyncPulse so any direct user activity
 * (opening the sync terminal sheet, tapping a retry button) auto-clears
 * an open layer breaker rather than making the user wait out the
 * 1-4 minute cooldown.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  resetLayerBreakerOnUserActivity,
  subscribeToLayerBreakerClose,
  isIdbLayerBreakerOpen,
  __test_only__resetLayerBreakerForTests,
  __test_only__getLayerBreakerStateForTests,
  __test_only__recordLayerBoundaryTimeoutForTests,
  __test_only__LAYER_BREAKER_THRESHOLD,
  __test_only__LAYER_BREAKER_BASE_COOLDOWN_MS,
} from '../offline-storage';

describe('resetLayerBreakerOnUserActivity', () => {
  beforeEach(() => {
    __test_only__resetLayerBreakerForTests();
  });

  it('is a no-op when the breaker is closed', () => {
    const subscriber = vi.fn();
    const unsubscribe = subscribeToLayerBreakerClose(subscriber);
    try {
      resetLayerBreakerOnUserActivity('test-noop');
      // No subscriber notification on no-op so we don't trigger
      // useless re-syncs in subscribers.
      expect(subscriber).not.toHaveBeenCalled();
      const state = __test_only__getLayerBreakerStateForTests();
      expect(state.trippedAt).toBeNull();
      expect(state.consecutiveTimeouts).toBe(0);
      // Reset count must remain 0 — no escalation on no-op.
      expect(state.resetCount).toBe(0);
    } finally {
      unsubscribe();
    }
  });

  it('clears an open breaker, resets the consecutive counter, and emits to subscribers', () => {
    // Trip the breaker the same way production code does — via threshold
    // consecutive boundary timeouts.
    for (let i = 0; i < __test_only__LAYER_BREAKER_THRESHOLD; i++) {
      __test_only__recordLayerBoundaryTimeoutForTests();
    }
    expect(isIdbLayerBreakerOpen()).toBe(true);

    const subscriber = vi.fn();
    const unsubscribe = subscribeToLayerBreakerClose(subscriber);
    try {
      resetLayerBreakerOnUserActivity('test-clear');
      expect(isIdbLayerBreakerOpen()).toBe(false);
      expect(subscriber).toHaveBeenCalledTimes(1);
      const state = __test_only__getLayerBreakerStateForTests();
      expect(state.trippedAt).toBeNull();
      expect(state.consecutiveTimeouts).toBe(0);
    } finally {
      unsubscribe();
    }
  });

  it('does NOT escalate the resetCount, so subsequent automatic trips start from base cooldown', () => {
    for (let i = 0; i < __test_only__LAYER_BREAKER_THRESHOLD; i++) {
      __test_only__recordLayerBoundaryTimeoutForTests();
    }
    const trippedState = __test_only__getLayerBreakerStateForTests();
    expect(trippedState.cooldownMs).toBe(__test_only__LAYER_BREAKER_BASE_COOLDOWN_MS);

    resetLayerBreakerOnUserActivity('first-reset');
    // Re-trip naturally
    for (let i = 0; i < __test_only__LAYER_BREAKER_THRESHOLD; i++) {
      __test_only__recordLayerBoundaryTimeoutForTests();
    }
    const reTrippedState = __test_only__getLayerBreakerStateForTests();
    // Cooldown stays at base — the user-driven reset doesn't punish the
    // subsequent automatic trip with an escalated cooldown.
    expect(reTrippedState.cooldownMs).toBe(__test_only__LAYER_BREAKER_BASE_COOLDOWN_MS);
  });

  it('is safe to call repeatedly during a single user gesture (idempotent)', () => {
    for (let i = 0; i < __test_only__LAYER_BREAKER_THRESHOLD; i++) {
      __test_only__recordLayerBoundaryTimeoutForTests();
    }
    const subscriber = vi.fn();
    const unsubscribe = subscribeToLayerBreakerClose(subscriber);
    try {
      resetLayerBreakerOnUserActivity('first');
      resetLayerBreakerOnUserActivity('second');
      resetLayerBreakerOnUserActivity('third');
      // Only the first call (which actually closed the breaker) emits;
      // subsequent calls find the breaker already closed and bail.
      expect(subscriber).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
});
