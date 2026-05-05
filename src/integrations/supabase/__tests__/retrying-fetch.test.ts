import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retryingFetch } from '../retrying-fetch';

describe('retryingFetch', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('idempotent requests (GET/HEAD/OPTIONS)', () => {
    it('returns the response from the first successful attempt without retrying', async () => {
      const ok = new Response('ok', { status: 200 });
      const fetchSpy = vi.fn(async () => ok);
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const res = await retryingFetch('https://example.com/data', { method: 'GET' });

      expect(res).toBe(ok);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('retries on TypeError: Failed to fetch and eventually returns success', async () => {
      const ok = new Response('ok', { status: 200 });
      const fetchSpy = vi.fn<typeof fetch>();
      fetchSpy
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(ok);
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const res = await retryingFetch('https://example.com/data');

      expect(res).toBe(ok);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('retries on Firefox-style NetworkError TypeError', async () => {
      const ok = new Response('ok', { status: 200 });
      const fetchSpy = vi.fn<typeof fetch>();
      fetchSpy
        .mockRejectedValueOnce(new TypeError('NetworkError when attempting to fetch resource.'))
        .mockResolvedValueOnce(ok);
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const res = await retryingFetch('https://example.com/data');

      expect(res).toBe(ok);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('gives up after the bounded retry budget and rethrows the last error', async () => {
      const err = new TypeError('Failed to fetch');
      const fetchSpy = vi.fn<typeof fetch>().mockRejectedValue(err);
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await expect(retryingFetch('https://example.com/data')).rejects.toBe(err);

      // Mode 13A: budget widened from 3 → 5 attempts so a ~30-60s outage
      // (real-world flaky cell handoff, CI runner network blip) doesn't
      // exhaust before the underlying network clears.
      expect(fetchSpy).toHaveBeenCalledTimes(5);
    });

    it('Mode 13A: recovers when the outage clears within the widened 5-attempt budget', async () => {
      // Simulates a longer transient outage that the previous 3-attempt
      // budget would have terminal-failed on.
      const ok = new Response('ok', { status: 200 });
      const fetchSpy = vi.fn<typeof fetch>();
      fetchSpy
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(ok);
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const res = await retryingFetch('https://example.com/data');

      expect(res).toBe(ok);
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it('does NOT retry on non-network errors (e.g. AbortError)', async () => {
      const abortErr = new DOMException('aborted', 'AbortError');
      const fetchSpy = vi.fn<typeof fetch>().mockRejectedValue(abortErr);
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await expect(retryingFetch('https://example.com/data')).rejects.toBe(abortErr);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('passes 4xx/5xx responses through unchanged (status check is the caller\'s job)', async () => {
      const errResponse = new Response('not found', { status: 404 });
      const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(errResponse);
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const res = await retryingFetch('https://example.com/missing');

      expect(res).toBe(errResponse);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('treats HEAD requests as idempotent', async () => {
      const ok = new Response(null, { status: 200 });
      const fetchSpy = vi.fn<typeof fetch>();
      fetchSpy
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(ok);
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const res = await retryingFetch('https://example.com/data', { method: 'HEAD' });

      expect(res).toBe(ok);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('mutating requests (POST/PATCH/PUT/DELETE)', () => {
    it('does NOT retry POST on TypeError: Failed to fetch — caller layer must handle idempotency', async () => {
      const err = new TypeError('Failed to fetch');
      const fetchSpy = vi.fn<typeof fetch>().mockRejectedValue(err);
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await expect(
        retryingFetch('https://example.com/data', { method: 'POST' }),
      ).rejects.toBe(err);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry PATCH', async () => {
      const err = new TypeError('Failed to fetch');
      const fetchSpy = vi.fn<typeof fetch>().mockRejectedValue(err);
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await expect(
        retryingFetch('https://example.com/data', { method: 'PATCH' }),
      ).rejects.toBe(err);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry DELETE', async () => {
      const err = new TypeError('Failed to fetch');
      const fetchSpy = vi.fn<typeof fetch>().mockRejectedValue(err);
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await expect(
        retryingFetch('https://example.com/data', { method: 'DELETE' }),
      ).rejects.toBe(err);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry POST passed as a Request object', async () => {
      const err = new TypeError('Failed to fetch');
      const fetchSpy = vi.fn<typeof fetch>().mockRejectedValue(err);
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const req = new Request('https://example.com/data', { method: 'POST' });
      await expect(retryingFetch(req)).rejects.toBe(err);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('method resolution', () => {
    it('defaults to GET (and retries) when no method is specified', async () => {
      const ok = new Response('ok', { status: 200 });
      const fetchSpy = vi.fn<typeof fetch>();
      fetchSpy
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(ok);
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const res = await retryingFetch('https://example.com/data');

      expect(res).toBe(ok);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('honors lowercase methods in init.method', async () => {
      const err = new TypeError('Failed to fetch');
      const fetchSpy = vi.fn<typeof fetch>().mockRejectedValue(err);
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      // 'post' → POST → no retry
      await expect(
        retryingFetch('https://example.com/data', { method: 'post' }),
      ).rejects.toBe(err);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
