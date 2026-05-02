/**
 * Transient-network retry wrapper for Playwright `APIRequestContext` calls
 * issued from test fixtures (mostly the `waitFor*` poll helpers in
 * `supabase.ts`). Mirrors the in-app `retryingFetch` from PR #50 — the
 * same problem (intermittent `TypeError: Failed to fetch` against
 * `*.supabase.co` from GitHub-Actions runners) bites the spec layer too,
 * but PR #50's wrapper only protects in-page fetches; tests use
 * Playwright's `request.newContext()` which has its own network stack.
 *
 * Posture (intentionally identical to production):
 *
 * - **Only network-layer errors retry.** `TypeError: Failed to fetch`
 *   (Chromium / Edge / Opera), `TypeError: NetworkError when attempting
 *   to fetch resource.` (Firefox), `Load failed` (Safari pre-iOS 17),
 *   plus a small set of Chromium net-stack codes (`ERR_INTERNET_DISCONNECTED`,
 *   `ERR_CONNECTION_RESET`, etc.) and abort/timeout boundary errors.
 *   Real assertion failures (4xx / 5xx HTTP responses) are NOT retried —
 *   they're returned to the caller untouched, so a genuine RLS denial,
 *   schema mismatch, or wrong row in the response still surfaces as a
 *   test failure.
 *
 * - **Bounded retry budget.** 4 total attempts (1 initial + 3 retries)
 *   with jittered exponential backoff: ~250ms, ~500ms, ~1000ms. Total
 *   worst-case extra latency is ~1.75s on top of the original failed
 *   attempts. Short enough that a real outage still fails the test in
 *   reasonable wall time, long enough that a single dropped packet
 *   doesn't take the gate down.
 *
 * - **Idempotency is the caller's responsibility.** Unlike the in-app
 *   `retryingFetch` (which only retries GET / HEAD / OPTIONS), this
 *   helper retries whatever block you pass to it. Read-only polling
 *   helpers (`waitFor*`) are inherently idempotent. Cleanup helpers
 *   (`purge*`) are also idempotent — re-deleting an already-deleted row
 *   is a no-op against PostgREST. Do NOT wrap mutating operations
 *   (POST / PATCH / PUT / DELETE that creates business state) without
 *   thinking about whether the original request might have reached the
 *   server before the connection died.
 *
 * Why fixture-side and not just a Playwright config option:
 *
 * Playwright's `request.newContext()` has no built-in retry-on-transient
 * option (only `maxRedirects`). Setting `retries: N` in
 * `playwright.config.ts` retries the whole **test** on failure — slow,
 * and it loses any state the test built up (e.g. an inspection ID
 * created in step 2 that step 4 needs to assert against). Wrapping the
 * individual REST calls is much cheaper and keeps the test linear.
 */

const TRANSIENT_NETWORK_PATTERNS: readonly RegExp[] = [
  // Chromium / Edge — fetch failed because offline or DNS unreachable.
  /failed to fetch/i,
  // Firefox.
  /networkerror when attempting to fetch resource/i,
  /networkerror/i,
  // Safari (pre-iOS 17).
  /load failed/i,
  // Chromium net-stack error codes.
  /err_internet_disconnected/i,
  /err_network_changed/i,
  /err_name_not_resolved/i,
  /err_connection_(refused|reset|closed|aborted|timed_out)/i,
  /err_network/i,
  /err_socket_not_connected/i,
  // Aborted in-flight request.
  /aborterror/i,
  /request was aborted/i,
  /the operation was aborted/i,
  // Timeouts.
  /timeouterror/i,
  /apirequestcontext\.\w+: timeout/i,
  /request timed out/i,
  // Playwright-specific socket errors.
  /socket hang up/i,
  /econnreset/i,
  /econnrefused/i,
  /etimedout/i,
  /enetunreach/i,
];

/** Public so tests can pin the contract. */
export function isTransientNetworkError(err: unknown): boolean {
  if (!err) return false;
  // Most Playwright/node fetch errors are `Error` subclasses with a
  // `message` field. Some surface only as plain strings (rare, but
  // observed when `apiClient.get` rejects with a wrapped reason).
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : (err as { message?: unknown })?.message;
  if (typeof message !== 'string' || !message) return false;
  return TRANSIENT_NETWORK_PATTERNS.some((re) => re.test(message));
}

export interface TransientRetryOptions {
  /** Max total attempts (1 initial + (N-1) retries). Default 4. */
  maxAttempts?: number;
  /** Base backoff in ms; doubled each retry. Default 250. */
  baseDelayMs?: number;
  /** Max additional jitter in ms added to each backoff. Default 100. */
  maxJitterMs?: number;
  /** Sleep impl (test seam). Default `setTimeout`-based promise. */
  sleep?: (ms: number) => Promise<void>;
  /** Random impl (test seam). Default `Math.random`. */
  random?: () => number;
  /** Optional human-readable label used in retry warning logs. */
  label?: string;
  /**
   * Predicate override (test seam). Default `isTransientNetworkError`.
   * Returning `true` means the error is transient and should be retried.
   */
  isTransient?: (err: unknown) => boolean;
}

const DEFAULT_OPTS = {
  maxAttempts: 4,
  baseDelayMs: 250,
  maxJitterMs: 100,
} as const;

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` and retry on transient network errors with jittered exponential
 * backoff. Re-throws the *last* error if all attempts fail; non-transient
 * errors propagate immediately on the very first attempt without any
 * retry / sleep overhead.
 *
 * The fixture polling helpers in `supabase.ts` use this to absorb
 * single-packet `Failed to fetch` blips against `*.supabase.co` without
 * re-issuing the entire 60-120s polling loop on every iteration.
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  opts: TransientRetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_OPTS.maxAttempts;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_OPTS.baseDelayMs;
  const maxJitterMs = opts.maxJitterMs ?? DEFAULT_OPTS.maxJitterMs;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const isTransient = opts.isTransient ?? isTransientNetworkError;
  const label = opts.label;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) {
        throw err;
      }
      if (attempt === maxAttempts) {
        break;
      }
      const backoff = baseDelayMs * 2 ** (attempt - 1);
      const jitter = random() * maxJitterMs;
      if (label) {
        // eslint-disable-next-line no-console
        console.warn(
          `[e2e transient-retry] ${label} attempt ${attempt}/${maxAttempts} ` +
            `failed with transient error; retrying in ${Math.round(
              backoff + jitter
            )}ms (${(err as Error)?.message ?? String(err)})`
        );
      }
      await sleep(backoff + jitter);
    }
  }
  throw lastErr;
}
