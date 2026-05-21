/**
 * Shell route warm-up (Phase 2 C).
 *
 * After a successful online sign-in / online boot, request the core
 * navigation targets so the existing service worker / Workbox runtime
 * caches them for offline cold-start.
 *
 * Bounded: one-shot per session, no retries on failure. Per-route
 * results are recorded into sessionStorage for the diagnostics card.
 */

const SESSION_FLAG = "shell-warmup.fired";
const RESULT_KEY = "shell-warmup.results";

export const SHELL_ROUTES = [
  "/",
  "/dashboard",
  "/inspection/new",
  "/training/new",
  "/daily-assessment/new",
  "/offline.html",
] as const;

export type ShellRouteResult = "ok" | "failed" | "skipped";
export type ShellWarmupResults = Record<string, ShellRouteResult>;

function writeResults(results: ShellWarmupResults) {
  try {
    sessionStorage.setItem(RESULT_KEY, JSON.stringify(results));
  } catch {
    // ignore
  }
}

export function getShellWarmupResults(): ShellWarmupResults | null {
  try {
    const raw = sessionStorage.getItem(RESULT_KEY);
    return raw ? (JSON.parse(raw) as ShellWarmupResults) : null;
  } catch {
    return null;
  }
}

async function waitForServiceWorker(timeoutMs = 2000): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  try {
    const ready = navigator.serviceWorker.ready.then(() => true);
    const timeout = new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), timeoutMs),
    );
    return await Promise.race([ready, timeout]);
  } catch {
    return false;
  }
}

export interface WarmShellOptions {
  /** Override the once-per-session guard (for tests / forced re-warm). */
  force?: boolean;
  /** Custom fetcher (tests). */
  fetcher?: typeof fetch;
}

export async function warmShellRoutes(
  opts: WarmShellOptions = {},
): Promise<ShellWarmupResults> {
  const { force = false, fetcher = fetch } = opts;

  // Skip in Lovable preview (read-only environment)
  try {
    if (
      typeof window !== "undefined" &&
      window.location?.hostname?.includes("id-preview--")
    ) {
      const skipped: ShellWarmupResults = {};
      for (const r of SHELL_ROUTES) skipped[r] = "skipped";
      writeResults(skipped);
      return skipped;
    }
  } catch {
    // ignore
  }

  if (!force) {
    try {
      if (sessionStorage.getItem(SESSION_FLAG) === "1") {
        return getShellWarmupResults() || {};
      }
    } catch {
      // ignore
    }
  }

  // Best-effort: wait briefly for SW so the first fetch hits the cache layer.
  await waitForServiceWorker(2000);

  const results: ShellWarmupResults = {};
  await Promise.all(
    SHELL_ROUTES.map(async (route) => {
      try {
        const res = await fetcher(route, {
          credentials: "same-origin",
          cache: "no-cache",
        });
        results[route] = res && res.ok ? "ok" : "failed";
      } catch {
        results[route] = "failed";
      }
    }),
  );

  try {
    sessionStorage.setItem(SESSION_FLAG, "1");
  } catch {
    // ignore
  }
  writeResults(results);
  return results;
}
