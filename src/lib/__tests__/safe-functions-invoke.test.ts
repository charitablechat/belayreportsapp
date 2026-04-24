/**
 * Contract tests for safeFunctionsInvoke — the non-sync transmit-boundary
 * guard that pairs with assertRealSessionForSync.
 *
 * The test stubs supabase.auth.getSession + supabase.functions.invoke so the
 * guard logic can be exercised without a real network or auth backend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/integrations/supabase/client', () => {
  const getSession = vi.fn();
  const invoke = vi.fn();
  return {
    supabase: {
      auth: { getSession },
      functions: { invoke },
    },
  };
});

import { safeFunctionsInvoke } from '../safe-functions-invoke';
import { supabase } from '@/integrations/supabase/client';
import { OFFLINE_PLACEHOLDER_TOKEN } from '../synthetic-session-guard';

const mockedGetSession = supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>;
const mockedInvoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;

const VALID_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature_part_here_xyz';

beforeEach(() => {
  mockedGetSession.mockReset();
  mockedInvoke.mockReset();
});

describe('safeFunctionsInvoke', () => {
  it('refuses to transmit the offline placeholder token', async () => {
    mockedGetSession.mockResolvedValue({
      data: { session: { access_token: OFFLINE_PLACEHOLDER_TOKEN } },
    });

    const result = await safeFunctionsInvoke('any-function', { body: { x: 1 } });

    expect(result.data).toBeNull();
    expect(result.error?.name).toBe('OfflinePlaceholderTokenError');
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('refuses to transmit a non-JWT-shaped token', async () => {
    mockedGetSession.mockResolvedValue({
      data: { session: { access_token: 'not-a-jwt-at-all' } },
    });

    const result = await safeFunctionsInvoke('any-function');

    expect(result.data).toBeNull();
    expect(result.error?.name).toBe('InvalidSessionTokenError');
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('forwards to supabase.functions.invoke when token is a real JWT', async () => {
    mockedGetSession.mockResolvedValue({
      data: { session: { access_token: VALID_JWT } },
    });
    mockedInvoke.mockResolvedValue({ data: { ok: true }, error: null });

    const result = await safeFunctionsInvoke<{ ok: boolean }>('my-fn', {
      body: { hello: 'world' },
    });

    expect(mockedInvoke).toHaveBeenCalledWith('my-fn', {
      body: { hello: 'world' },
      headers: undefined,
      method: undefined,
    });
    expect(result.data).toEqual({ ok: true });
    expect(result.error).toBeNull();
  });

  it('fails open on getSession errors and lets the invoke run', async () => {
    mockedGetSession.mockRejectedValue(new Error('storage unavailable'));
    mockedInvoke.mockResolvedValue({ data: { fallback: true }, error: null });

    const result = await safeFunctionsInvoke('my-fn');

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(result.data).toEqual({ fallback: true });
  });

  it('passes through invoke errors without altering shape', async () => {
    mockedGetSession.mockResolvedValue({
      data: { session: { access_token: VALID_JWT } },
    });
    mockedInvoke.mockResolvedValue({
      data: null,
      error: { name: 'FunctionsHttpError', message: 'boom' },
    });

    const result = await safeFunctionsInvoke('my-fn');

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ name: 'FunctionsHttpError', message: 'boom' });
  });
});
