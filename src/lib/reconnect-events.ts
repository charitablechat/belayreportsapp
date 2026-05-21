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
 * Tracked listener references are retained so `__test_only__resetReconnectEvents`
 * can remove them cleanly between tests (otherwise the flag-only reset
 * would leak listeners and inflate dispatch counts).
 */

import { runReconnect } from "./reconnect-coordinator";

let initialized = false;

type Registered = {
  target: EventTarget;
  type: string;
  handler: EventListener;
};
let registered: Registered[] = [];

export function initReconnectEvents(): void {
  if (initialized) return;
  if (typeof window === "undefined") return;
  initialized = true;

  const fire = (trigger: "online" | "visibility" | "pageshow" | "focus") => {
    void runReconnect(trigger);
  };

  const add = (target: EventTarget, type: string, handler: EventListener) => {
    target.addEventListener(type, handler);
    registered.push({ target, type, handler });
  };

  try {
    add(window, "online", () => fire("online"));
    add(window, "focus", () => fire("focus"));
    add(window, "pageshow", () => fire("pageshow"));
    if (typeof document !== "undefined") {
      add(document, "visibilitychange", () => {
        if (document.visibilityState === "visible") fire("visibility");
      });
    }
  } catch {
    /* non-browser/test env */
  }
}

/** Test-only: removes all registered listeners and clears the init flag. */
export function __test_only__resetReconnectEvents(): void {
  for (const r of registered) {
    try {
      r.target.removeEventListener(r.type, r.handler);
    } catch {
      /* ignore */
    }
  }
  registered = [];
  initialized = false;
}
