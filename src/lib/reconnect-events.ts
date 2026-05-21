/**
 * Reconnect-event wiring.
 *
 * Single place that subscribes the browser's connectivity/visibility
 * signals to the `reconnect-coordinator`'s `runReconnect()` entry point.
 * The coordinator itself enforces single-flight + min-gap; this module
 * only fans triggers into it.
 *
 * Triggers fanned in (in priority order):
 *   - `online`           (browser came back online)
 *   - `visibilitychange` (tab became visible)
 *   - `pageshow`         (bfcache resume — iOS PWA)
 *   - `focus`            (window regained focus)
 *
 * `auth` and `manual` triggers are NOT registered here — they are
 * fired by `cached-auth.ts` (SIGNED_IN) and by user actions
 * (e.g. "Sync now") via `runReconnect("auth"|"manual")`.
 *
 * Idempotent: calling `initReconnectEvents()` a second time is a no-op.
 */

import { runReconnect } from "./reconnect-coordinator";

let initialized = false;

export function initReconnectEvents(): void {
  if (initialized) return;
  if (typeof window === "undefined") return;
  initialized = true;

  const fire = (trigger: "online" | "visibility" | "pageshow" | "focus") => {
    // Fire-and-forget — coordinator never throws.
    void runReconnect(trigger);
  };

  try {
    window.addEventListener("online", () => fire("online"));
    window.addEventListener("focus", () => fire("focus"));
    window.addEventListener("pageshow", () => fire("pageshow"));
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") fire("visibility");
      });
    }
  } catch {
    /* non-browser/test env */
  }
}

/** Test-only: tears down the init flag so tests can re-arm listeners. */
export function __test_only__resetReconnectEvents(): void {
  initialized = false;
}
