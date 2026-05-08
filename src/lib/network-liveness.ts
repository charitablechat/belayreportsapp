/**
 * Sprint 2 F: `navigator.onLine` false-positive guard.
 *
 * iOS Safari (and occasionally Chromium) flips `navigator.onLine` to
 * `false` for short windows during Wi-Fi → cellular handoffs, when the
 * device wakes from background, or when the underlying NetworkChangeNotifier
 * sees a transient blip. The browser will report `false` even though the
 * radio is actually up and a fetch issued in that same tick would
 * succeed.
 *
 * This module records the timestamp of the most recent fetch that
 * actually round-tripped to the server (any HTTP response counts —
 * 2xx / 4xx / 5xx all prove the radio is up; only `TypeError` from a
 * dropped TCP/DNS layer means we couldn't reach anything). Sync-engine
 * entry gates that previously short-circuited on `!navigator.onLine`
 * can now check `isLikelyOnline()` instead, which gives the radio a
 * 30-second grace window before treating the browser's offline flag
 * as authoritative.
 *
 * Risk if Safari is RIGHT and we proceed anyway: one wasted sync
 * attempt that fails with `TypeError: Failed to fetch`, retryingFetch
 * burns its retry budget, and the photos get a fresh `nextRetryAt`
 * stamp on the next cycle. Compare to the bug we're fixing (sync
 * stalls for minutes because Safari is wrong) — clear win.
 *
 * Wired into `retryingFetch` (the wrapper Supabase's createClient uses
 * for ALL Postgrest reads/writes) so success recording is automatic
 * for every call that flows through Supabase. Direct `fetch` callers
 * outside Supabase still get the strict `navigator.onLine` semantics
 * via the default branch of `isLikelyOnline()`.
 */

let lastSuccessfulNetworkAt: number | null = null;

/** Default grace window in ms. Picked to comfortably exceed iOS Safari's
 * observed handoff blips (~5-15s typical) without letting a truly long
 * outage (e.g. user really did walk into a dead zone) silently mask the
 * `navigator.onLine=false` signal. */
export const DEFAULT_LIVENESS_GRACE_MS = 30_000;

/**
 * Mark the network as definitely-up at this instant. Call from any
 * fetch wrapper that just received a response (any status). Cheap and
 * idempotent — safe to call from hot paths.
 */
export function recordNetworkSuccess(now: number = Date.now()): void {
  lastSuccessfulNetworkAt = now;
}

/**
 * Returns the most recent recorded success timestamp, or `null` if no
 * fetch has succeeded since module load. Exported for diagnostic
 * surfaces (e.g. SyncPulse's halt-reason details, the future
 * "Run diagnostic" button in Sprint 2 I).
 */
export function getLastSuccessfulNetworkAt(): number | null {
  return lastSuccessfulNetworkAt;
}

/**
 * Returns `true` if the browser thinks we're online OR a fetch
 * succeeded within the last `recencyMs` window. The grace branch is
 * what prevents a Safari false-positive from stalling the sync
 * engine.
 *
 * Safe to call from SSR / non-browser contexts: when `navigator` is
 * undefined we fall back to checking the recency window only.
 */
export function isLikelyOnline(
  now: number = Date.now(),
  recencyMs: number = DEFAULT_LIVENESS_GRACE_MS,
): boolean {
  const browserOnline =
    typeof navigator === 'undefined' ? false : navigator.onLine;
  if (browserOnline) return true;
  if (lastSuccessfulNetworkAt === null) return false;
  return now - lastSuccessfulNetworkAt < recencyMs;
}

/**
 * Test-only helper to reset module-scoped state between vitest runs.
 * Production code MUST NOT call this — the module's state is meant to
 * persist for the life of the document. Exported under an explicit
 * `__test` prefix so it can't be confused with a normal helper.
 */
export function __resetNetworkLivenessForTest(): void {
  lastSuccessfulNetworkAt = null;
}
