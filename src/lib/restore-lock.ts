/**
 * Restore Lock (H2 + N-H + audit M3)
 * ──────────────────────────────────
 * The restore flow (DataRecoveryTool → saveInspection/Training/AssessmentOffline)
 * writes records with `synced_at = null` and `updated_at = Date.now()`. If the
 * auto-sync cycle fires while the restore is mid-flight (or 1-2s after, before
 * the user has even navigated to the restored report), the restored record can:
 *
 *  1. Be picked up by an in-flight batch and pushed to the server using the
 *     T0 snapshot still living in the atomic-sync closure (see C4).
 *  2. Be re-overwritten by a post-commit local save that clobbers the
 *     freshly-restored child rows.
 *
 * The restore flow is the user's emergency recovery tool — it must be atomic
 * against sync. This module exposes a tiny ref-counted lock that:
 *
 *   • performSync() in useAutoSync checks `isRestoreInProgress()` early and
 *     bails out (the next sync-data-changed / interval tick will retry).
 *   • Restore handlers wrap their work in `withRestoreLock(async () => …)`,
 *     which increments on entry and decrements on exit (even on throw).
 *
 * Multiple concurrent restores are supported via ref-counting so that a bulk
 * "restore N snapshots" action (future) doesn't unlock between iterations.
 *
 * N-H (crash safety):
 * The in-memory ref-count alone is not tab-crash-safe. If the tab is killed
 * by the OS (iOS memory pressure, backgrounded PWA, user swipe-closing
 * between the start of a large restore and its completion), the next
 * launch has `_restoreCount = 0` but IndexedDB still holds partially-written
 * records with `synced_at = null`. Auto-sync would then push those
 * half-written rows to the server before the user finishes the restore.
 *
 * Mitigation: persist a timestamp + operation id to sessionStorage each time
 * the lock transitions from idle → held. On module load we check for a
 * stale entry (< 15 minutes old) and, if present, block sync for the
 * remainder of that window so the user has a chance to re-open the tab
 * and resume the restore (or let it time out cleanly).
 *
 * sessionStorage (not localStorage) because:
 *   • Per-tab: a tab crash clears the storage, so a *fresh* launch in a
 *     new tab doesn't inherit the ghost lock. Only reloads of the crashed
 *     tab see it — which is exactly the case we want to guard.
 *   • Survives reloads: React StrictMode double-mounts, visibilitychange
 *     bailouts, and the `beforeunload → reload` refresh loop all preserve
 *     sessionStorage.
 *
 * Audit M3 (cross-tab):
 * The N-H mitigation is per-tab (sessionStorage). If the user opens the
 * same app in two tabs and starts a restore in tab A, tab B's auto-sync
 * cycle has no idea and will happily push the half-written rows that
 * tab A has staged. The restore lock must be cross-tab.
 *
 * Mitigation: on each acquire/release the lock broadcasts a message via
 * `BroadcastChannel('belayreports-restore-lock-v1')` and tracks remote holders
 * in an in-memory Map keyed on tab id. While held, the holding tab
 * heartbeats every 5s; remote holders that haven't heartbeated within
 * 15s are evicted (e.g. another tab crashed). On module load, the new
 * tab broadcasts a `query` message; any remote holder responds with its
 * current state so the new tab learns the lock is held without waiting
 * for the next heartbeat. `isRestoreInProgress()` also returns true if
 * any live remote holder is present.
 *
 * BroadcastChannel is available in all current Safari versions on iPad
 * (iOS 15.4+); on older browsers it's `undefined` and the cross-tab
 * branch silently no-ops, falling back to per-tab semantics. This is
 * the same posture as the rest of the codebase (e.g. cached-auth
 * handles BroadcastChannel undefined gracefully).
 */

const PERSIST_KEY = "restore-lock-v1";
// 15 minutes is enough for any legitimate restore (largest inspections in
// the field run < 5 min). After that window, a lingering entry is treated
// as stale and the lock is released.
const CRASH_TTL_MS = 15 * 60 * 1000;

// Audit M3: cross-tab signal config.
const BROADCAST_CHANNEL_NAME = "belayreports-restore-lock-v1";
// Heartbeat the local hold every 5s so other tabs know we're still alive.
const HEARTBEAT_INTERVAL_MS = 5_000;
// Remote holders that haven't heartbeated within this window are considered
// crashed. Slightly larger than 2x interval so a missed packet doesn't evict.
const REMOTE_TTL_MS = 15_000;

interface PersistedLockState {
  heldSince: number;
  /** Incremented each time the lock is acquired; used as a tie-breaker. */
  epoch: number;
}

interface RemoteHolder {
  heldSince: number;
  lastHeartbeat: number;
}

type ChannelMessage =
  | { type: "acquired"; tabId: string; heldSince: number }
  | { type: "released"; tabId: string }
  | { type: "heartbeat"; tabId: string; heldSince: number }
  | { type: "query" }
  | { type: "state"; tabId: string; heldSince: number };

let _restoreCount = 0;
const listeners = new Set<(active: boolean) => void>();

// Audit M3: per-tab cross-tab state.
const TAB_ID = generateTabId();
const remoteHolders = new Map<string, RemoteHolder>();
let channel: BroadcastChannel | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function generateTabId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function notify(active: boolean) {
  listeners.forEach(l => {
    try { l(active); } catch (err) { console.error('[RestoreLock] listener error', err); }
  });
}

function readPersisted(): PersistedLockState | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.heldSince === "number" &&
      typeof parsed.epoch === "number"
    ) {
      return parsed as PersistedLockState;
    }
    return null;
  } catch {
    return null;
  }
}

function writePersisted(state: PersistedLockState | null): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (state === null) {
      sessionStorage.removeItem(PERSIST_KEY);
    } else {
      sessionStorage.setItem(PERSIST_KEY, JSON.stringify(state));
    }
  } catch {
    /* sessionStorage unavailable or full — the in-memory lock still works;
       crash safety is the only thing we lose. */
  }
}

// Audit M3: BroadcastChannel helpers. Lazy-init so module load is cheap and
// jsdom (where BroadcastChannel may be undefined) stays compatible.
function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  try {
    // Browser-only: gate on a real DOM environment AND skip in vitest where
    // jsdom routes BroadcastChannel to Node's worker_threads MessagePort,
    // whose self-dispatch emits a Node MessageEvent that fails
    // browser-EventTarget validation (ERR_INVALID_ARG_TYPE). In real
    // browsers `import.meta.env.MODE !== 'test'` so this guard has no
    // production effect; tests can drive the cross-tab logic directly via
    // mocked dependencies.
    if (typeof window === "undefined") return null;
    if (typeof window.BroadcastChannel === "undefined") return null;
    if (import.meta.env?.MODE === "test") return null;
    channel = new window.BroadcastChannel(BROADCAST_CHANNEL_NAME);
    // Use `onmessage` setter rather than `addEventListener('message', …)` —
    // Node's globalThis.BroadcastChannel (used by vitest jsdom) routes the
    // message payload through a non-Event-wrapping path that triggers
    // ERR_INVALID_ARG_TYPE on the EventTarget side. The `onmessage` setter
    // takes the raw payload directly. Browsers honor either form.
    channel.onmessage = handleChannelMessage;
    // On startup, ask any other tabs that already hold the lock to identify
    // themselves so we don't have to wait for the next heartbeat.
    try {
      channel.postMessage({ type: "query" } satisfies ChannelMessage);
    } catch {
      /* ignore */
    }
    return channel;
  } catch {
    return null;
  }
}

function postChannel(msg: ChannelMessage): void {
  const ch = getChannel();
  if (!ch) return;
  try {
    ch.postMessage(msg);
  } catch {
    /* ignore — channel unavailable */
  }
}

function pruneStaleRemoteHolders(): void {
  const now = Date.now();
  for (const [id, h] of remoteHolders) {
    if (now - h.lastHeartbeat > REMOTE_TTL_MS) {
      remoteHolders.delete(id);
    }
  }
}

function handleChannelMessage(ev: MessageEvent<ChannelMessage>): void {
  const msg = ev?.data;
  if (!msg || typeof msg !== "object") return;
  // Ignore our own messages — most browsers don't echo back, but be safe.
  if ("tabId" in msg && msg.tabId === TAB_ID) return;
  switch (msg.type) {
    case "acquired":
    case "heartbeat":
    case "state": {
      remoteHolders.set(msg.tabId, {
        heldSince: msg.heldSince,
        lastHeartbeat: Date.now(),
      });
      break;
    }
    case "released": {
      remoteHolders.delete(msg.tabId);
      break;
    }
    case "query": {
      // Another tab just started up. Reply with our state if we currently hold.
      if (_restoreCount > 0) {
        const persisted = readPersisted();
        const heldSince = persisted?.heldSince ?? Date.now();
        postChannel({ type: "state", tabId: TAB_ID, heldSince });
      }
      break;
    }
  }
}

function startHeartbeat(heldSince: number): void {
  if (heartbeatTimer) return;
  if (typeof setInterval === "undefined") return;
  heartbeatTimer = setInterval(() => {
    postChannel({ type: "heartbeat", tabId: TAB_ID, heldSince });
  }, HEARTBEAT_INTERVAL_MS);
  // Don't keep the Node event loop alive in tests / SSR.
  const t = heartbeatTimer as unknown as { unref?: () => void };
  if (typeof t.unref === "function") t.unref();
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * True while at least one restore is in flight. Sync cycles MUST short-circuit
 * when this returns true.
 *
 * N-H: Also returns true if a stale persisted lock from a recent tab crash
 * is still within its TTL window; the next call after the window passes
 * auto-clears the stale entry.
 *
 * Audit M3: Also returns true if any *other* tab has signaled an active
 * restore (heartbeat within REMOTE_TTL_MS).
 */
export function isRestoreInProgress(): boolean {
  if (_restoreCount > 0) return true;
  // Audit M3: cross-tab check before falling back to crash sentinel.
  // Lazy-init the channel so a sync cycle that runs before any restore
  // happens still discovers a sibling tab's lock.
  getChannel();
  pruneStaleRemoteHolders();
  if (remoteHolders.size > 0) return true;
  const persisted = readPersisted();
  if (!persisted) return false;
  const age = Date.now() - persisted.heldSince;
  if (age >= CRASH_TTL_MS) {
    // Stale entry from a long-ago crash — self-heal.
    writePersisted(null);
    return false;
  }
  return true;
}

/**
 * Subscribe to lock state transitions (false → true on first acquire, true →
 * false on final release). Returns an unsubscribe.
 */
export function onRestoreLockChange(listener: (active: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Run `fn` while the restore lock is held. Lock is released even if `fn`
 * throws. Safe to nest / interleave with other restores.
 */
export async function withRestoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const wasIdle = _restoreCount === 0;
  _restoreCount += 1;
  if (wasIdle) {
    if (import.meta.env.DEV) console.log('[RestoreLock] acquired (sync paused)');
    // N-H: persist so a tab crash between here and the finally block still
    // blocks the next launch's first sync cycle.
    const prev = readPersisted();
    const heldSince = Date.now();
    writePersisted({
      heldSince,
      epoch: (prev?.epoch ?? 0) + 1,
    });
    // Audit M3: announce to sibling tabs and start heartbeating.
    postChannel({ type: "acquired", tabId: TAB_ID, heldSince });
    startHeartbeat(heldSince);
    notify(true);
  }
  try {
    return await fn();
  } finally {
    _restoreCount -= 1;
    if (_restoreCount <= 0) {
      _restoreCount = 0;
      if (import.meta.env.DEV) console.log('[RestoreLock] released (sync resumed)');
      // N-H: clear the persisted sentinel on clean release.
      writePersisted(null);
      // Audit M3: announce release and stop heartbeating.
      stopHeartbeat();
      postChannel({ type: "released", tabId: TAB_ID });
      notify(false);
    }
  }
}

/**
 * N-H: Force-clear a stale persisted lock. Primarily for diagnostics / the
 * DataRecoveryTool "reset" action. Does NOT touch the in-memory ref count —
 * an actually-held lock is unaffected.
 */
export function clearPersistedRestoreLock(): void {
  writePersisted(null);
}

/**
 * Audit M3: Test-only — clear remote-holder state. Used by tests to reset
 * cross-tab signaling between cases. Production code should never call this.
 */
export function _resetCrossTabStateForTesting(): void {
  remoteHolders.clear();
  stopHeartbeat();
  if (channel) {
    try {
      channel.onmessage = null;
      channel.close();
    } catch {
      /* ignore */
    }
    channel = null;
  }
}

/**
 * Audit M3: Test-only — drive the cross-tab message handler directly.
 * Lets specs simulate sibling-tab messages without needing a real
 * BroadcastChannel (which doesn't behave correctly under vitest jsdom —
 * see comment on getChannel above).
 */
export function _handleChannelMessageForTesting(ev: { data: unknown }): void {
  handleChannelMessage(ev as MessageEvent<ChannelMessage>);
}

/**
 * Audit M3: Test-only — inject a mock BroadcastChannel so specs can assert
 * on emitted messages (acquired / released / state replies).
 */
export function _setChannelForTesting(mock: unknown): void {
  channel = mock as BroadcastChannel | null;
}

/**
 * Audit M3: Test-only — seed a remote-holder entry so specs can verify
 * pruneStaleRemoteHolders evicts aged-out tabs.
 */
export function _setRemoteHolderForTesting(
  tabId: string,
  heldSince: number,
  lastHeartbeat: number,
): void {
  remoteHolders.set(tabId, { heldSince, lastHeartbeat });
}

/**
 * Audit M3: Test-only — read the per-tab id so specs can confirm self-emitted
 * messages are ignored.
 */
export function _getOwnTabIdForTesting(): string {
  return TAB_ID;
}
