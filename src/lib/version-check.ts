/**
 * Server-side version check — defense in depth against silent SW failures.
 *
 * Polls the deployed app's /version.json (served as a static asset, excluded
 * from SW precache + runtime cache) and compares it to the locally-built
 * APP_VERSION. If they differ AND no PWA update event has fired within a
 * reasonable window, surface a soft refresh banner so users on iOS/corp-
 * proxied/flaky-CDN connections aren't stuck on stale builds forever.
 */
import { APP_VERSION } from './attestation';

const VERSION_URL = '/version.json';
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

export interface VersionCheckResult {
  current: string;
  deployed: string | null;
  deployedBuild: string | null;
  isStale: boolean;
  checkedAt: Date;
}

async function fetchDeployedVersion(): Promise<{ version: string | null; build: string | null }> {
  if (typeof fetch === 'undefined') return { version: null, build: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return { version: null, build: null };
    const data = await res.json();
    return {
      version: typeof data?.version === 'string' ? data.version : null,
      build: typeof data?.build === 'string' ? data.build : null,
    };
  } catch {
    return { version: null, build: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strip any `+build` suffix or pre-release tag before comparing — we only
 * compare the numeric SemVer core. (Currently /version.json never includes
 * a `+` suffix, but be defensive.)
 */
function stripSuffix(v: string): string {
  return v.split(/[+-]/, 1)[0] || v;
}

export function isVersionNewer(current: string, deployed: string, strict = false): boolean {
  if (!current || !deployed || current === 'unknown') return false;
  if (current === deployed) return false;
  if (strict) return current !== deployed;

  const parse = (v: string) => stripSuffix(v).split('.').map((p) => parseInt(p, 10) || 0);
  const [cMaj, cMin, cPatch] = parse(current);
  const [dMaj, dMin, dPatch] = parse(deployed);
  if (dMaj !== cMaj) return dMaj > cMaj;
  if (dMin !== cMin) return dMin > cMin;
  return dPatch > cPatch;
}

// Dev-only self-test: catches regressions in the comparator immediately.
// Costs nothing in prod (DEV is a static define stripped by Vite).
if (import.meta.env?.DEV) {
  try {
    const assert = (cond: boolean, msg: string) => {
      if (!cond) throw new Error(`[version-check self-test] ${msg}`);
    };
    assert(isVersionNewer('4.7.5', '4.7.6') === true, 'patch increment must be newer');
    assert(isVersionNewer('4.7.10', '4.7.9') === false, 'patch decrement must not be newer');
    assert(isVersionNewer('4.7.142', '4.7.143') === true, 'multi-digit patch must compare numerically');
    assert(isVersionNewer('4.7.5', '4.7.5') === false, 'equal must not be newer');
    assert(isVersionNewer('4.7.9', '4.8.1') === true, 'minor bump must be newer');
    assert(isVersionNewer('5.0.1', '4.9.99') === false, 'lower major must not be newer');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export async function checkVersion(): Promise<VersionCheckResult> {
  const { version: deployed, build: deployedBuild } = await fetchDeployedVersion();
  return {
    current: APP_VERSION,
    deployed,
    deployedBuild,
    isStale: deployed ? isVersionNewer(APP_VERSION, deployed, false) : false,
    checkedAt: new Date(),
  };
}

type Listener = (result: VersionCheckResult) => void;
const listeners = new Set<Listener>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let lastResult: VersionCheckResult | null = null;
let lastForegroundCheck = 0;
const FOREGROUND_THROTTLE_MS = 30 * 1000;

export function getLastVersionResult(): VersionCheckResult | null {
  return lastResult;
}

async function poll(): Promise<VersionCheckResult> {
  const result = await checkVersion();
  lastResult = result;
  // Broadcast on EVERY poll so UI can show "deployed" even when equal
  listeners.forEach((l) => {
    try {
      l(result);
    } catch {
      // ignore
    }
  });
  return result;
}

/**
 * Run an immediate version check, bypassing throttles. Used by the
 * "Check for Updates" panel to give instant feedback. Also re-touches
 * telemetry last_seen so admin distribution stays live.
 */
export async function forceVersionCheck(): Promise<VersionCheckResult> {
  const result = await poll();
  // Lazy import to avoid circular dep with version-telemetry
  try {
    const mod = await import('./version-telemetry');
    void mod.touchVersionTelemetry?.();
  } catch {
    // ignore
  }
  return result;
}

async function onVisibilityForeground() {
  if (typeof document === 'undefined') return;
  if (document.visibilityState !== 'visible') return;

  const now = Date.now();
  if (now - lastForegroundCheck < FOREGROUND_THROTTLE_MS) return;
  lastForegroundCheck = now;

  void poll();

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

export function subscribeVersionCheck(listener: Listener): () => void {
  listeners.add(listener);
  if (lastResult) {
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
