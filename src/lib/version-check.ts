/**
 * Server-side version check — defense in depth against silent SW failures.
 *
 * Polls the deployed app's /version.json (served as a static asset, excluded
 * from SW precache + runtime cache) and compares it to the locally-built
 * APP_VERSION. If they differ AND no PWA update event has fired within a
 * reasonable window, surface a soft refresh banner so users on iOS/corp-
 * proxied/flaky-CDN connections aren't stuck on stale builds forever.
 *
 * Cross-platform notes:
 * - iOS Safari: pins SW script for 24h. We add a `visibilitychange`
 *   listener that calls registration.update() when the tab returns to
 *   foreground, catching foregrounded PWAs that missed periodic checks.
 * - Android/desktop Chrome: standard SW autoUpdate handles 99% of cases;
 *   the banner is a safety net for the long tail.
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
    // Cache-bust + no-store: defeats CDN, browser HTTP cache, and any
    // accidentally-cached responses. /version.json is also excluded from
    // the SW runtime cache (NetworkOnly in vite-pwa-config.ts).
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Cache-Control': 'no-cache' },
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
let lastForegroundCheck = 0;
const FOREGROUND_THROTTLE_MS = 30 * 1000;

async function poll() {
  const result = await checkVersion();
  lastResult = result;
  if (result.isStale) {
    listeners.forEach((l) => {
      try {
        l(result);
      } catch {
        // ignore
      }
    });
  }
}

/**
 * Trigger an SW update check + version poll when the tab comes to foreground.
 * Critical on iOS where backgrounded PWAs do not run periodic SW checks.
 */
async function onVisibilityForeground() {
  if (typeof document === 'undefined') return;
  if (document.visibilityState !== 'visible') return;

  const now = Date.now();
  if (now - lastForegroundCheck < FOREGROUND_THROTTLE_MS) return;
  lastForegroundCheck = now;

  // 1) Re-poll version.json (sees new deploys before the SW does)
  void poll();

  // 2) Nudge the SW to check for updates as well
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        void reg.update().catch(() => {});
      }
    }
  } catch {
    // ignore
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
    setTimeout(() => { void poll(); }, 30_000);
    intervalId = setInterval(() => void poll(), POLL_INTERVAL_MS);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityForeground);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onVisibilityForeground);
    }
  }
  return () => {
    listeners.delete(listener);
  };
}
