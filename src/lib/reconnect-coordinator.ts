/**
 * Reconnect Coordinator — single-flight, observable, ordered.
 *
 * Problem solved
 * --------------
 * Reconnect events arrive from many directions: the browser `online`
 * event, `visibilitychange` (tab becomes visible), `pageshow` (iOS bf-cache
 * resume), `focus`, the auth state machine, and manual user actions
 * (e.g. "Sync now"). Each of these may independently trigger:
 *   - auth/session reconciliation,
 *   - report-queue sync drain,
 *   - photo-queue drain,
 *   - deletion-queue processing,
 *   - dashboard/local-state refresh,
 *   - optional data/photo pre-warm.
 *
 * Without coordination, these flows race each other on reconnect, log
 * duplicate work, and make field debugging painful.
 *
 * This module exposes a single function `runReconnect(trigger)` that:
 *   - is single-flight (only one drain at a time; concurrent callers
 *     await the in-flight promise),
 *   - runs stages in a documented order,
 *   - records every stage on the global event bus so the Sync Terminal
 *     and tests can observe progress,
 *   - never throws — stage failures are recorded and never block the
 *     next reconnect attempt,
 *   - has a bounded minimum gap between sequences (5s) so flapping
 *     online/offline does not stack drains.
 *
 * This module does NOT replace `useAutoSync`'s existing throttling,
 * debouncing, or in-flight guards inside `performSync`. It sits ABOVE
 * them as the deterministic outer envelope.
 *
 * Stages
 * ------
 *   reconnect.start
 *   reconnect.auth-reconcile
 *   reconnect.report-queue-drain
 *   reconnect.photo-queue-drain
 *   reconnect.deletion-queue-drain
 *   reconnect.refresh-local-state
 *   reconnect.prewarm
 *   reconnect.complete   |   reconnect.failed
 *
 * Guest sessions skip stages that would transmit to Supabase.
 */

import { isGuestUserId } from "./guest-session";

export type ReconnectTrigger =
  | "online"
  | "visibility"
  | "pageshow"
  | "focus"
  | "auth"
  | "manual";

export type ReconnectStage =
  | "auth-reconcile"
  | "report-queue-drain"
  | "photo-queue-drain"
  | "deletion-queue-drain"
  | "refresh-local-state"
  | "prewarm";

export interface ReconnectStageEvent {
  type: "start" | "stage-ok" | "stage-failed" | "complete" | "failed";
  trigger: ReconnectTrigger;
  stage?: ReconnectStage;
  error?: string;
  durationMs?: number;
  at: number;
}

type Listener = (e: ReconnectStageEvent) => void;
const listeners = new Set<Listener>();

export function onReconnectEvent(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function emit(e: ReconnectStageEvent): void {
  for (const cb of listeners) {
    try {
      cb(e);
    } catch {
      /* listeners must not break the coordinator */
    }
  }
  try {
    window.dispatchEvent(new CustomEvent("rw-reconnect-event", { detail: e }));
  } catch {
    /* non-browser/test env */
  }
}

// ---- Stage runner registry ------------------------------------------------
// `useAutoSync` (or any other module) registers concrete stage runners at
// mount time so the coordinator stays decoupled from React state.

export interface ReconnectRunners {
  authReconcile?: () => Promise<unknown> | unknown;
  reportQueueDrain?: () => Promise<unknown> | unknown;
  photoQueueDrain?: () => Promise<unknown> | unknown;
  deletionQueueDrain?: () => Promise<unknown> | unknown;
  refreshLocalState?: () => Promise<unknown> | unknown;
  prewarm?: () => Promise<unknown> | unknown;
}

let runners: ReconnectRunners = {};

/**
 * Register or update stage runners. Last-write-wins per key.
 * Returns an `unregister` function that restores the previous mapping.
 */
export function registerReconnectRunners(next: ReconnectRunners): () => void {
  const previous: ReconnectRunners = { ...runners };
  runners = { ...runners, ...next };
  return () => {
    runners = { ...previous };
  };
}

// ---- Single-flight + min-gap ---------------------------------------------

let inFlight: Promise<void> | null = null;
let lastCompletedAt = 0;
const MIN_GAP_MS = 5_000;

export function _resetReconnectCoordinatorForTests(): void {
  inFlight = null;
  lastCompletedAt = 0;
  runners = {};
  listeners.clear();
}

export function isReconnectInFlight(): boolean {
  return inFlight !== null;
}

/** Optional override for tests; resolves a current userId for guest-skip logic. */
let userIdResolver: () => string | null = () => null;
export function setReconnectUserIdResolver(fn: () => string | null): void {
  userIdResolver = fn;
}

async function runStage(
  trigger: ReconnectTrigger,
  stage: ReconnectStage,
  fn: (() => Promise<unknown> | unknown) | undefined,
): Promise<void> {
  if (!fn) return;
  const startedAt = Date.now();
  try {
    await fn();
    emit({
      type: "stage-ok",
      trigger,
      stage,
      durationMs: Date.now() - startedAt,
      at: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({
      type: "stage-failed",
      trigger,
      stage,
      error: message,
      durationMs: Date.now() - startedAt,
      at: Date.now(),
    });
    // Swallow — coordinator must never throw out of a stage so the next
    // trigger can still attempt recovery.
  }
}

/**
 * Run the reconnect sequence. If one is already running, return the
 * in-flight promise. If one completed less than MIN_GAP_MS ago, no-op
 * (returns resolved promise) — except when `trigger === 'manual'`.
 */
export function runReconnect(trigger: ReconnectTrigger): Promise<void> {
  if (inFlight) return inFlight;

  const sinceLast = Date.now() - lastCompletedAt;
  if (trigger !== "manual" && sinceLast < MIN_GAP_MS) {
    return Promise.resolve();
  }

  const sequence = (async () => {
    emit({ type: "start", trigger, at: Date.now() });
    const isGuest = isGuestUserId(userIdResolver());
    try {
      if (!isGuest) {
        await runStage(trigger, "auth-reconcile", runners.authReconcile);
        await runStage(trigger, "report-queue-drain", runners.reportQueueDrain);
        await runStage(trigger, "photo-queue-drain", runners.photoQueueDrain);
        await runStage(
          trigger,
          "deletion-queue-drain",
          runners.deletionQueueDrain,
        );
      }
      // Guests still need their local view refreshed (e.g. after a
      // visibility change repaints).
      await runStage(trigger, "refresh-local-state", runners.refreshLocalState);
      if (!isGuest) {
        await runStage(trigger, "prewarm", runners.prewarm);
      }
      emit({ type: "complete", trigger, at: Date.now() });
    } catch (err) {
      // Defensive — should never reach here because runStage swallows.
      emit({
        type: "failed",
        trigger,
        error: err instanceof Error ? err.message : String(err),
        at: Date.now(),
      });
    } finally {
      lastCompletedAt = Date.now();
      inFlight = null;
    }
  })();

  inFlight = sequence;
  return sequence;
}
