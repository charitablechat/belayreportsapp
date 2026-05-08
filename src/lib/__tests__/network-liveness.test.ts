/**
 * Sprint 2 F: contract tests for the navigator.onLine false-positive guard.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  recordNetworkSuccess,
  isLikelyOnline,
  getLastSuccessfulNetworkAt,
  __resetNetworkLivenessForTest,
  DEFAULT_LIVENESS_GRACE_MS,
} from '../network-liveness';

describe('network-liveness', () => {
  let onLineSpy: ReturnType<typeof vi.spyOn>;
  let currentOnLine = true;

  beforeEach(() => {
    __resetNetworkLivenessForTest();
    currentOnLine = true;
    // jsdom's `navigator.onLine` is a getter — spy on it so we can flip
    // it per-test without mutating the global object directly.
    onLineSpy = vi
      .spyOn(navigator, 'onLine', 'get')
      .mockImplementation(() => currentOnLine);
  });

  afterEach(() => {
    onLineSpy.mockRestore();
  });

  describe('isLikelyOnline()', () => {
    it('returns true when navigator.onLine is true regardless of recency', () => {
      currentOnLine = true;
      expect(isLikelyOnline()).toBe(true);
    });

    it('returns false when navigator.onLine is false and no fetch has succeeded', () => {
      currentOnLine = false;
      expect(isLikelyOnline()).toBe(false);
    });

    it('returns true during the grace window after a successful fetch even when navigator.onLine flips false', () => {
      const t0 = 1_000_000;
      recordNetworkSuccess(t0);
      currentOnLine = false;
      // 5s into the grace window
      expect(isLikelyOnline(t0 + 5_000)).toBe(true);
      // Just inside the 30s default boundary
      expect(isLikelyOnline(t0 + DEFAULT_LIVENESS_GRACE_MS - 1)).toBe(true);
    });

    it('returns false once the grace window expires', () => {
      const t0 = 1_000_000;
      recordNetworkSuccess(t0);
      currentOnLine = false;
      // Exactly at boundary — strict less-than, so no longer in grace
      expect(isLikelyOnline(t0 + DEFAULT_LIVENESS_GRACE_MS)).toBe(false);
      // Well past
      expect(isLikelyOnline(t0 + 60_000)).toBe(false);
    });

    it('honors a custom recency window', () => {
      const t0 = 1_000_000;
      recordNetworkSuccess(t0);
      currentOnLine = false;
      // 10s after success, default 30s grace would say true — but a 5s
      // custom window says false.
      expect(isLikelyOnline(t0 + 10_000, 5_000)).toBe(false);
      expect(isLikelyOnline(t0 + 4_999, 5_000)).toBe(true);
    });

    it('updates the recency timestamp on each successful fetch', () => {
      const t0 = 1_000_000;
      recordNetworkSuccess(t0);
      currentOnLine = false;
      // Just past the original window
      expect(isLikelyOnline(t0 + DEFAULT_LIVENESS_GRACE_MS + 1)).toBe(false);
      // A second success extends the window
      recordNetworkSuccess(t0 + DEFAULT_LIVENESS_GRACE_MS + 1);
      expect(isLikelyOnline(t0 + DEFAULT_LIVENESS_GRACE_MS + 1)).toBe(true);
    });
  });

  describe('getLastSuccessfulNetworkAt()', () => {
    it('returns null when no fetch has succeeded', () => {
      expect(getLastSuccessfulNetworkAt()).toBeNull();
    });

    it('returns the most recent recorded timestamp', () => {
      recordNetworkSuccess(1_000_000);
      expect(getLastSuccessfulNetworkAt()).toBe(1_000_000);
      recordNetworkSuccess(2_000_000);
      expect(getLastSuccessfulNetworkAt()).toBe(2_000_000);
    });
  });
});
