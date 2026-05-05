/**
 * Retrying `fetch` wrapper for the Supabase client.
 *
 * Mitigates intermittent `TypeError: Failed to fetch` errors observed on:
 *   1. GitHub Actions runners during e2e specs (admin-pre-edit-override
 *      in particular has a long serial chain of cloud roundtrips and
 *      flakes on different layers run-to-run).
 *   2. Real users on flaky cellular networks where a Wi-Fi → cellular
 *      handoff drops a single fetch but the next one would succeed.
 *
 * The wrapper is conservative on purpose:
 *
 * - **Only idempotent methods** (GET / HEAD / OPTIONS) are retried.
 *   Mutating verbs (POST / PATCH / PUT / DELETE) are NEVER retried at
 *   this layer because we cannot tell from a `TypeError: Failed to
 *   fetch` whether the original request reached the server before the
 *   connection died. Retrying a half-applied mutation could create
 *   duplicate audit-trail rows (admin_edit_snapshots), child rows, or
 *   double-incremented counters. Mutations that need durability under
 *   network instability already have their own retry/queue layers
 *   higher up the stack (atomic-sync-manager, admin-edit-snapshot-queue,
 *   form `syncWithRetry`) which handle idempotency correctly.
 *
 * - **Only network-layer errors** (`TypeError`) are retried. HTTP-level
 *   errors (4xx / 5xx) are returned to the caller untouched — those are
 *   handled by Supabase's PostgREST error envelope and by callers.
 *
 * - **Bounded retry budget** with jittered exponential backoff so a
 *   prolonged outage doesn't turn a single user action into a 30s
 *   stall. Mode 13A widened the budget from 3 attempts to 5 to cover
 *   the longer end of real-world cell-handoff and CI-runner network
 *   blips (PR #129's CI run-25297867x showed five distinct supabase.co
 *   callers all hitting `Failed to fetch` within a single ~40s window —
 *   the previous 3×~250ms ceiling exhausted faster than the underlying
 *   outage cleared). Total worst-case latency for the slow path is
 *   now ~250 + 500 + 1000 + 2000 + 4000 ≈ 7.75s on top of the original
 *   failed attempt; jitter widened to ±250ms so concurrent callers
 *   don't synchronise their retry storms against the same recovering
 *   endpoint.
 *
 * Read paths benefiting from this layer (the ones we observed flake
 * most often in CI):
 * - dashboard list fetches (`inspections`, `trainings`, `daily_assessments`)
 * - profile / announcement / global-history reads
 * - `waitForInspection*` and `waitForAdminEditSnapshot` poll queries used
 *   by e2e specs
 */

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Mode 13A: 3 → 5 attempts. The previous ~1.75s ceiling was sized for a
// "single transient blip in an otherwise-healthy connection" but in CI
// (and on flaky cell handoffs in production) we routinely see ~30-60s
// outages where every supabase.co call dies in parallel. Widening to 5
// attempts brings the worst-case slow path to ~7.75s while keeping the
// healthy path unchanged (first attempt succeeds → zero overhead).
const MAX_ATTEMPTS = 5;       // 1 initial + 4 retries
const BASE_DELAY_MS = 250;    // first retry waits ~250-500ms
const MAX_JITTER_MS = 250;

function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === 'object' && 'method' in (input as Request)) {
    return (input as Request).method.toUpperCase();
  }
  return 'GET';
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Drop-in replacement for the global `fetch` that retries idempotent
 * requests on transient network failures. Pass to
 * `createClient(url, key, { global: { fetch: retryingFetch } })`.
 */
export async function retryingFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = resolveMethod(input, init);
  const idempotent = IDEMPOTENT_METHODS.has(method);
  const maxAttempts = idempotent ? MAX_ATTEMPTS : 1;

  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      lastErr = err;

      // Only retry on network-layer errors. `TypeError: Failed to fetch`
      // (Chrome/Edge/Opera) and `TypeError: NetworkError when attempting
      // to fetch resource.` (Firefox) both surface as `TypeError`.
      if (!(err instanceof TypeError)) {
        throw err;
      }
      if (attempt === maxAttempts) {
        break;
      }

      const backoff = BASE_DELAY_MS * 2 ** (attempt - 1);
      const jitter = Math.random() * MAX_JITTER_MS;
      await delay(backoff + jitter);
    }
  }

  throw lastErr;
}
