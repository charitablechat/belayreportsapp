/**
 * safeFunctionsInvoke — pre-flight session guard for `supabase.functions.invoke`.
 *
 * Wraps `supabase.functions.invoke` with the same synthetic-session-guard
 * pre-flight that `assertRealSessionForSync` (atomic-sync-manager.ts) uses for
 * the sync pipeline:
 *
 *   1. `isUnsafeToTransmit` — refuses to send the offline placeholder token.
 *   2. `looksLikeJwt`       — refuses to send anything that isn't shaped like a JWT.
 *
 * If either check fails, the call short-circuits with a typed error result
 * (matches the shape of `supabase.functions.invoke`'s `{ data, error }` so it
 * is a drop-in replacement at most call sites).
 *
 * Why a separate helper instead of editing the supabase client?
 *   `src/integrations/supabase/client.ts` is auto-generated and off-limits.
 *   We can't install a global `fetch` interceptor, so each transmit boundary
 *   that wants the guard opts in by importing this helper.
 *
 * Sync-path callers should keep using `assertRealSessionForSync` directly —
 * it produces the user-facing "Session expired" toast and is already wired in.
 *
 * See `mem://security/supabase-transmit-guard` for the full boundary policy.
 */

import { supabase } from '@/integrations/supabase/client';
import { isUnsafeToTransmit, looksLikeJwt } from '@/lib/synthetic-session-guard';

export interface SafeInvokeOptions {
  /** Forwarded to `supabase.functions.invoke`. */
  body?: unknown;
  /** Forwarded to `supabase.functions.invoke`. */
  headers?: Record<string, string>;
  /** Forwarded to `supabase.functions.invoke`. */
  method?: 'POST' | 'GET' | 'PUT' | 'PATCH' | 'DELETE';
  /**
   * Caller context label for log lines. Defaults to the function name.
   * Helps trace which boundary refused to transmit.
   */
  ctx?: string;
}

export interface SafeInvokeResult<T = unknown> {
  data: T | null;
  error: { name: string; message: string } | null;
}

/**
 * Invoke a Supabase edge function with a session pre-flight.
 *
 * Returns the same `{ data, error }` shape as `supabase.functions.invoke`.
 * On a failed pre-flight, `data` is `null` and `error.name` is one of:
 *   - `OfflinePlaceholderTokenError` — placeholder token would have leaked.
 *   - `InvalidSessionTokenError`     — token is missing or not a JWT.
 */
export async function safeFunctionsInvoke<T = unknown>(
  functionName: string,
  options: SafeInvokeOptions = {}
): Promise<SafeInvokeResult<T>> {
  const ctx = options.ctx ?? `functions.invoke:${functionName}`;

  let token: string | undefined;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    token = session?.access_token;
  } catch {
    // Read failure — fail open and let the underlying invoke do its own auth check.
    // This matches `assertRealSessionForSync`'s fail-open posture on getSession errors.
  }

  if (token) {
    if (isUnsafeToTransmit(token, ctx)) {
      return {
        data: null,
        error: {
          name: 'OfflinePlaceholderTokenError',
          message:
            'Refused to transmit offline placeholder token. ' +
            'Sign in again before retrying.',
        },
      };
    }
    if (!looksLikeJwt(token)) {
      return {
        data: null,
        error: {
          name: 'InvalidSessionTokenError',
          message: 'Session access_token is not a valid JWT.',
        },
      };
    }
  }

  const { data, error } = await supabase.functions.invoke(functionName, {
    body: options.body,
    headers: options.headers,
    method: options.method,
  });

  return {
    data: data as T | null,
    error: error
      ? { name: (error as { name?: string }).name ?? 'FunctionsHttpError', message: error.message }
      : null,
  };
}
