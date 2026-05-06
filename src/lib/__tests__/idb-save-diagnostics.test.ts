/**
 * Mode 14: contract tests for `captureIdbSaveDiagnostics`.
 *
 * The helper runs INSIDE the timeout/idb_closing/unknown error paths of
 * `withIndexedDBSaveBoundary`, so it must:
 *   - Never throw, even when navigator.storage methods reject or are absent.
 *   - Always return the synchronous fields (store, *Ms, timeoutMs).
 *   - Race storage.estimate() against a short timeout so a wedged Safari
 *     can't hold the failure path open.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('captureIdbSaveDiagnostics', () => {
  let originalNavigator: Navigator | undefined;

  beforeEach(() => {
    originalNavigator = globalThis.navigator;
  });

  afterEach(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
    vi.restoreAllMocks();
  });

  it('returns the synchronous shape with store + elapsedMs + timeoutMs even with no navigator.storage', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'jsdom-ua', platform: 'jsdom' },
      configurable: true,
    });
    const { __test_only__captureIdbSaveDiagnosticsForTests: capture } = await import('../offline-storage');
    const out = await capture({
      store: 'inspections',
      probeMs: 5,
      opMs: 7990,
      elapsedMs: 7995,
      timeoutMs: 8000,
    });
    expect(out).toMatchObject({
      store: 'inspections',
      probeMs: 5,
      opMs: 7990,
      elapsedMs: 7995,
      timeoutMs: 8000,
      userAgent: 'jsdom-ua',
      platform: 'jsdom',
    });
    expect(typeof out.inPostOnlineGrace).toBe('boolean');
  });

  it('captures storage.estimate quota / usage / usagePct when available', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'jsdom-ua',
        platform: 'jsdom',
        storage: {
          estimate: vi.fn().mockResolvedValue({ quota: 1_000_000_000, usage: 250_000_000 }),
          persisted: vi.fn().mockResolvedValue(true),
        },
      },
      configurable: true,
    });
    const { __test_only__captureIdbSaveDiagnosticsForTests: capture } = await import('../offline-storage');
    const out = await capture({
      store: 'global',
      elapsedMs: 100,
      timeoutMs: 8000,
    });
    expect(out.quotaBytes).toBe(1_000_000_000);
    expect(out.usageBytes).toBe(250_000_000);
    expect(out.usagePct).toBe(25);
    expect(out.persisted).toBe(true);
  });

  it('does not throw when storage.estimate rejects or hangs', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'jsdom-ua',
        platform: 'jsdom',
        storage: {
          // Hangs forever — race-against-timeout must resolve to null.
          estimate: () => new Promise<StorageEstimate>(() => {}),
          persisted: () => new Promise<boolean>(() => {}),
        },
      },
      configurable: true,
    });
    const { __test_only__captureIdbSaveDiagnosticsForTests: capture } = await import('../offline-storage');
    const out = await capture({
      store: 'inspections',
      elapsedMs: 100,
      timeoutMs: 8000,
    });
    // Race against the diagnostic's internal 1s/500ms timeout — fields stay
    // undefined but the promise resolves cleanly.
    expect(out.quotaBytes).toBeUndefined();
    expect(out.usageBytes).toBeUndefined();
    expect(out.persisted ?? null).toBeNull();
  }, 3000);
});
