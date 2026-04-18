/**
 * Server-side version check — defense in depth against silent SW failures.
 *
 * Polls the deployed app's /version.json (served as a static asset) and
 * compares it to the locally-built APP_VERSION. If they differ AND no PWA
 * update event has fired within a reasonable window, surface a soft refresh
 * banner so users on iOS/corp-proxied/flaky-CDN connections aren't stuck on
 * stale builds forever.
 *
 * Why /version.json (not an edge function)?
 * - Zero infra. The file already exists in the repo and is deployed with
 *   every build. Cache-busting via querystring guarantees a fresh read.
 * - Works offline-friendly (failure is silent — we just don't show banner).
 */
import { APP_VERSION } from './attestation';

const VERSION_URL = '/version.json';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 8000;

export interface VersionCheckResult {
  current: string;
  deployed: string | null;
  isStale: boolean;
}

async function fetchDeployedVersion(): Promise<string | null> {
  if (typeof fetch === 'undefined') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.version === 'string' ? data.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns true if the deployed version's BASE (major.minor) is newer than
 * the running version's base. Patch differences alone are ignored because
 * the patch is computed from commit count and may legitimately wobble
 * between mirrored CDN edges.
 *
 * For exact matching pass strict=true.
 */
export function isVersionNewer(current: string, deployed: string, strict = false): boolean {
  if (!current || !deployed || current === 'unknown') return false;
  if (current === deployed) return false;
  if (strict) return current !== deployed;

  const parse = (v: string) => v.split('.').map((p) => parseInt(p, 10) || 0);
  const [cMaj, cMin] = parse(current);
  const [dMaj, dMin] = parse(deployed);
  if (dMaj > cMaj) return true;
  if (dMaj === cMaj && dMin > cMin) return true;
  return false;
}

export async function checkVersion(): Promise<VersionCheckResult> {
  const deployed = await fetchDeployedVersion();
  return {
    current: APP_VERSION,
    deployed,
    isStale: deployed ? isVersionNewer(APP_VERSION, deployed, false) : false,
  };
}

type Listener = (result: VersionCheckResult) => void;
const listeners = new Set<Listener>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let lastResult: VersionCheckResult | null = null;

async function poll() {
  const result = await checkVersion();
  lastResult = result;
  if (result.isStale) {
    listeners.forEach((l) => {
      try {
        l(result);
      } catch {
        // ignore listener errors
      }
    });
  }
}

/**
 * Start polling /version.json. Returns an unsubscribe function.
 * Safe to call multiple times — only one poll loop runs.
 */
export function subscribeVersionCheck(listener: Listener): () => void {
  listeners.add(listener);
  if (lastResult?.isStale) {
    try {
      listener(lastResult);
    } catch {
      // ignore
    }
  }
  if (!intervalId) {
    // Initial check after 30s to avoid competing with app boot
    setTimeout(() => {
      void poll();
    }, 30_000);
    intervalId = setInterval(() => void poll(), POLL_INTERVAL_MS);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void poll();
      });
    }
  }
  return () => {
    listeners.delete(listener);
  };
}
