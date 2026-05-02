import { describe, it, expect, vi } from 'vitest';
import {
  isTransientNetworkError,
  withTransientRetry,
} from './transient-retry';

describe('isTransientNetworkError', () => {
  const transientCases: Array<[string, string]> = [
    ['Chromium fetch fail', 'TypeError: Failed to fetch'],
    [
      'Chromium fetch fail with origin',
      'TypeError: Failed to fetch (ssgzcgvygnsrqalisshx.supabase.co)',
    ],
    ['Firefox fetch fail', 'NetworkError when attempting to fetch resource.'],
    ['bare NetworkError', 'NetworkError'],
    ['Safari fetch fail', 'Load failed'],
    ['Chromium offline', 'net::ERR_INTERNET_DISCONNECTED'],
    ['Chromium connection reset', 'net::ERR_CONNECTION_RESET'],
    ['Chromium connection refused', 'net::ERR_CONNECTION_REFUSED'],
    ['Chromium connection timed out', 'net::ERR_CONNECTION_TIMED_OUT'],
    ['Chromium name not resolved', 'net::ERR_NAME_NOT_RESOLVED'],
    ['AbortError', 'AbortError: The user aborted a request.'],
    ['the operation was aborted', 'The operation was aborted.'],
    ['Playwright timeout', 'apiRequestContext.get: Timeout 30000ms exceeded'],
    ['node socket hang up', 'socket hang up'],
    ['node ECONNRESET', 'connect ECONNRESET 1.2.3.4:443'],
    ['node ETIMEDOUT', 'connect ETIMEDOUT'],
  ];

  it.each(transientCases)(
    'classifies as transient: %s',
    (_label, message) => {
      expect(isTransientNetworkError(new Error(message))).toBe(true);
    }
  );

  const persistentCases: Array<[string, string]> = [
    ['HTTP 401', '401 Unauthorized'],
    ['HTTP 403 RLS', 'permission denied for table inspections'],
    ['HTTP 404', 'Not Found'],
    ['HTTP 409 conflict', 'duplicate key value violates unique constraint'],
    ['HTTP 422 schema', 'invalid input syntax for type uuid'],
    ['JSON parse', 'Unexpected token < in JSON at position 0'],
    ['assertion mismatch', 'expected location to equal X but got Y'],
    ['empty array', 'no rows returned'],
  ];

  it.each(persistentCases)(
    'classifies as persistent: %s',
    (_label, message) => {
      expect(isTransientNetworkError(new Error(message))).toBe(false);
    }
  );

  it('returns false for null / undefined / empty', () => {
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
    expect(isTransientNetworkError('')).toBe(false);
    expect(isTransientNetworkError(new Error(''))).toBe(false);
  });

  it('accepts plain string error', () => {
    expect(isTransientNetworkError('Failed to fetch')).toBe(true);
    expect(isTransientNetworkError('not found')).toBe(false);
  });

  it('accepts plain object with message field', () => {
    expect(isTransientNetworkError({ message: 'Failed to fetch' })).toBe(true);
    expect(isTransientNetworkError({ message: 'permission denied' })).toBe(false);
  });
});

describe('withTransientRetry', () => {
  function makeOpts(overrides: Partial<Parameters<typeof withTransientRetry>[1]> = {}) {
    return {
      maxAttempts: 4,
      baseDelayMs: 1,
      maxJitterMs: 0,
      sleep: vi.fn().mockResolvedValue(undefined),
      random: () => 0,
      ...overrides,
    };
  }

  it('returns the value on first success without sleeping', async () => {
    const opts = makeOpts();
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withTransientRetry(fn, opts)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(opts.sleep).not.toHaveBeenCalled();
  });

  it('retries transient errors up to maxAttempts and then resolves', async () => {
    const opts = makeOpts();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce('ok');
    await expect(withTransientRetry(fn, opts)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(opts.sleep).toHaveBeenCalledTimes(2);
  });

  it('uses exponential backoff doubling each attempt', async () => {
    const opts = makeOpts({ baseDelayMs: 100, maxJitterMs: 0 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce('ok');
    await withTransientRetry(fn, opts);
    expect(opts.sleep).toHaveBeenNthCalledWith(1, 100);
    expect(opts.sleep).toHaveBeenNthCalledWith(2, 200);
    expect(opts.sleep).toHaveBeenNthCalledWith(3, 400);
  });

  it('rethrows the last transient error after exhausting attempts', async () => {
    const opts = makeOpts();
    const err = new Error('Failed to fetch');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withTransientRetry(fn, opts)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(4);
    expect(opts.sleep).toHaveBeenCalledTimes(3);
  });

  it('rethrows persistent errors immediately on first attempt without retrying', async () => {
    const opts = makeOpts();
    const err = new Error('permission denied for table inspections');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withTransientRetry(fn, opts)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(opts.sleep).not.toHaveBeenCalled();
  });

  it('rethrows assertion mismatches immediately (not classified as transient)', async () => {
    const opts = makeOpts();
    const err = new Error("expected location to equal 'X edited' but got 'X'");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withTransientRetry(fn, opts)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects custom isTransient predicate', async () => {
    const opts = makeOpts({
      isTransient: (err) => (err as Error).message === 'CUSTOM',
    });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('CUSTOM'))
      .mockResolvedValueOnce('ok');
    await expect(withTransientRetry(fn, opts)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('logs a warning when label is provided on each retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const opts = makeOpts({ label: 'waitForFoo' });
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Failed to fetch'))
        .mockResolvedValueOnce('ok');
      await withTransientRetry(fn, opts);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toMatch(/waitForFoo attempt 1\/4/);
    } finally {
      warn.mockRestore();
    }
  });

  it('does not log when label is omitted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const opts = makeOpts();
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Failed to fetch'))
        .mockResolvedValueOnce('ok');
      await withTransientRetry(fn, opts);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('honors maxAttempts=1 (no retries)', async () => {
    const opts = makeOpts({ maxAttempts: 1 });
    const err = new Error('Failed to fetch');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withTransientRetry(fn, opts)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(opts.sleep).not.toHaveBeenCalled();
  });

  it('mixes transient and persistent: persistent breaks the loop', async () => {
    const opts = makeOpts();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('permission denied'));
    await expect(withTransientRetry(fn, opts)).rejects.toThrow(
      'permission denied'
    );
    expect(fn).toHaveBeenCalledTimes(2);
    expect(opts.sleep).toHaveBeenCalledTimes(1);
  });
});
