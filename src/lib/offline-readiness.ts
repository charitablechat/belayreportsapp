/**
 * Offline Readiness — Phase 0 telemetry.
 *
 * Non-blocking instrumentation that records:
 *   1. A snapshot of the device's offline readiness (SW, cache, IDB,
 *      auth fallbacks) — emitted after each successful online boot/sign-in.
 *   2. The chosen `boot.auth.outcome` (which fallback rung the user
 *      reached the dashboard through).
 *   3. A `save.no-identity` counter for offline writes that had no
 *      user-id to attach.
 *
 * All data goes through the existing log-error / Sentry pipeline as
 * breadcrumbs. No new transport, no PII, no report content.
 */

import { logError } from "@/lib/log-error";
import { hasLastKnownAccount } from "@/lib/last-known-account";

export type BootAuthOutcome =
  | "online-session"
  | "cached-supabase-session"
  | "synthetic-session"
  | "offline-auth-refresh-token-resume"
  | "last-known-account-resume"
  | "guest-session"
  | "guest-offered"
  | "dead-end-auth-screen"
  | "captive-portal-offline-mode"
  | "first-pwa-launch-needs-online-signin";

const BREADCRUMB_PREFIX = "[offline-readiness]";

function isStandalonePWA(): boolean {
  try {
    return (
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      window.matchMedia?.("(display-mode: window-controls-overlay)").matches === true ||
      (window.navigator as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

function isIOS(): boolean {
  try {
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
  } catch {
    return false;
  }
}

function isAndroid(): boolean {
  try {
    return /Android/i.test(navigator.userAgent || "");
  } catch {
    return false;
  }
}

async function probeShellCached(): Promise<{ index: boolean; offline: boolean }> {
  try {
    if (!("caches" in window)) return { index: false, offline: false };
    const [index, offline] = await Promise.all([
      caches.match("/index.html", { ignoreSearch: true }).then((r) => !!r),
      caches.match("/offline.html", { ignoreSearch: true }).then((r) => !!r),
    ]);
    return { index, offline };
  } catch {
    return { index: false, offline: false };
  }
}

async function probeServiceWorker(): Promise<{
  installed: boolean;
  controller: boolean;
  ready: boolean;
}> {
  try {
    if (!("serviceWorker" in navigator)) {
      return { installed: false, controller: false, ready: false };
    }
    const regs = await navigator.serviceWorker.getRegistrations();
    const installed = regs.length > 0;
    const controller = !!navigator.serviceWorker.controller;
    let ready = false;
    try {
      await Promise.race([
        navigator.serviceWorker.ready.then(() => {
          ready = true;
        }),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } catch {
      // leave ready=false
    }
    return { installed, controller, ready };
  } catch {
    return { installed: false, controller: false, ready: false };
  }
}

async function probePersistentStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persisted) return null;
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}

export interface OfflineReadinessSnapshot {
  // Service worker
  swInstalled: boolean;
  swControllerPresent: boolean;
  serviceWorkerReady: boolean;
  // Shell
  indexHtmlCached: boolean;
  offlineHtmlCached: boolean;
  // Auth fallbacks
  localStorageSessionPresent: boolean;
  syntheticSessionPresent: boolean;
  guestSessionPresent: boolean;
  lastKnownAccountPresent: boolean;
  // Storage
  persistentStorageGranted: boolean | null;
  // Environment
  isStandalonePWA: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  navigatorOnLine: boolean;
  capturedAt: number;
}

/**
 * Build a snapshot without throwing. Safe to call at any boot stage.
 * Inputs are passed in so this module doesn't pull in the cached-auth
 * graph (which would create an import cycle).
 */
export async function captureOfflineReadinessSnapshot(inputs: {
  localStorageSessionPresent: boolean;
  syntheticSessionPresent: boolean;
  guestSessionPresent: boolean;
}): Promise<OfflineReadinessSnapshot> {
  const [sw, shell, persisted] = await Promise.all([
    probeServiceWorker(),
    probeShellCached(),
    probePersistentStorage(),
  ]);
  const snapshot: OfflineReadinessSnapshot = {
    swInstalled: sw.installed,
    swControllerPresent: sw.controller,
    serviceWorkerReady: sw.ready,
    indexHtmlCached: shell.index,
    offlineHtmlCached: shell.offline,
    localStorageSessionPresent: inputs.localStorageSessionPresent,
    syntheticSessionPresent: inputs.syntheticSessionPresent,
    guestSessionPresent: inputs.guestSessionPresent,
    lastKnownAccountPresent: hasLastKnownAccount(),
    persistentStorageGranted: persisted,
    isStandalonePWA: isStandalonePWA(),
    isIOS: isIOS(),
    isAndroid: isAndroid(),
    navigatorOnLine: typeof navigator !== "undefined" ? navigator.onLine : true,
    capturedAt: Date.now(),
  };
  try {
    sessionStorage.setItem(
      "offline-readiness-last-snapshot",
      JSON.stringify(snapshot),
    );
  } catch {
    // ignore
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(BREADCRUMB_PREFIX, snapshot);
  }
  return snapshot;
}

export function getLastOfflineReadinessSnapshot(): OfflineReadinessSnapshot | null {
  try {
    const raw = sessionStorage.getItem("offline-readiness-last-snapshot");
    if (!raw) return null;
    return JSON.parse(raw) as OfflineReadinessSnapshot;
  } catch {
    return null;
  }
}

/**
 * Record which auth fallback rung the user landed on. Single source of
 * truth so dashboards / Sentry can answer "how did the user get in?".
 */
export function recordBootAuthOutcome(outcome: BootAuthOutcome, extra?: Record<string, unknown>): void {
  try {
    sessionStorage.setItem("boot.auth.outcome", outcome);
  } catch {
    // ignore
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`${BREADCRUMB_PREFIX} boot.auth.outcome=${outcome}`, extra || {});
  }
  // Only treat the dead-end as a real error; the rest are breadcrumbs.
  if (outcome === "dead-end-auth-screen") {
    logError(new Error("boot.auth.outcome=dead-end-auth-screen"), {
      scope: "offline-readiness.boot",
      extra: { outcome, ...extra },
    });
  }
}

/**
 * Increment the save-without-identity counter. The first 5 occurrences
 * per session report to Sentry; further ones are coalesced.
 */
const noIdentityKey = "save.no-identity.count";
export function recordSaveWithoutIdentity(extra?: Record<string, unknown>): void {
  let count = 0;
  try {
    count = parseInt(sessionStorage.getItem(noIdentityKey) || "0", 10) || 0;
    sessionStorage.setItem(noIdentityKey, String(count + 1));
  } catch {
    // ignore
  }
  if (count < 5) {
    logError(new Error("save.no-identity"), {
      scope: "offline-readiness.save",
      extra: { count: count + 1, ...extra },
    });
  } else if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(`${BREADCRUMB_PREFIX} save.no-identity (suppressed) count=${count + 1}`);
  }
}

/**
 * Request persistent-storage. Browsers may grant silently (Chrome on
 * installed PWA, Firefox after engagement) or prompt (Safari rarely
 * grants). Idempotent: safe to call on every successful sign-in.
 */
export async function requestPersistentStorageOnce(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    // Skip if we've already been granted.
    const already = await navigator.storage.persisted?.();
    if (already) return true;
    const granted = await navigator.storage.persist();
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log(`${BREADCRUMB_PREFIX} storage.persist() → ${granted}`);
    }
    return granted;
  } catch {
    return null;
  }
}
