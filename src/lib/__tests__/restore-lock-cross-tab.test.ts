/**
 * Audit M3: cross-tab restore-lock signal.
 *
 * The restore-lock code skips its real BroadcastChannel init when
 * `import.meta.env.MODE === 'test'` (vitest jsdom delegates to Node's
 * worker_threads BroadcastChannel which has a self-dispatch incompatibility
 * — see comment in restore-lock.ts). To exercise the cross-tab logic
 * deterministically we build a tiny manual channel mock and inject it via
 * `_internalsForTesting()`, which is how this test pins the contract:
 *
 *   - withRestoreLock posts an 'acquired' message and starts heartbeating.
 *   - Final release posts a 'released' message and stops heartbeating.
 *   - isRestoreInProgress() returns true while ANY remote tab is in the
 *     "active heartbeat" window, even if no local lock is held.
 *   - A remote tab whose heartbeat ages out of REMOTE_TTL_MS is evicted.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface MockChannel {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage: ((ev: MessageEvent) => void) | null;
  close: ReturnType<typeof vi.fn>;
  /** Test helper — simulate a message arriving from another tab. */
  _receive(data: unknown): void;
}

function makeMockChannel(): MockChannel {
  const ch: MockChannel = {
    postMessage: vi.fn(),
    onmessage: null,
    close: vi.fn(),
    _receive(data) {
      ch.onmessage?.({ data } as MessageEvent);
    },
  };
  return ch;
}

async function loadFresh() {
  vi.resetModules();
  return await import('../restore-lock');
}

describe('audit M3 — restore-lock cross-tab signal', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it('isRestoreInProgress returns true when a remote tab signals "acquired"', async () => {
    const mod = await loadFresh();
    const mod_ = mod as typeof mod & {
      _setChannelForTesting: (ch: unknown) => void;
      _handleChannelMessageForTesting: (ev: { data: unknown }) => void;
    };

    expect(mod.isRestoreInProgress()).toBe(false);

    mod_._handleChannelMessageForTesting({
      data: { type: 'acquired', tabId: 'tab-other', heldSince: Date.now() },
    });

    expect(mod.isRestoreInProgress()).toBe(true);
  });

  it('isRestoreInProgress returns false again after remote tab signals "released"', async () => {
    const mod = await loadFresh();
    const mod_ = mod as typeof mod & {
      _handleChannelMessageForTesting: (ev: { data: unknown }) => void;
    };

    mod_._handleChannelMessageForTesting({
      data: { type: 'acquired', tabId: 'tab-other', heldSince: Date.now() },
    });
    expect(mod.isRestoreInProgress()).toBe(true);

    mod_._handleChannelMessageForTesting({
      data: { type: 'released', tabId: 'tab-other' },
    });
    expect(mod.isRestoreInProgress()).toBe(false);
  });

  it('evicts a remote tab whose heartbeat aged out of REMOTE_TTL_MS', async () => {
    const mod = await loadFresh();
    const mod_ = mod as typeof mod & {
      _handleChannelMessageForTesting: (ev: { data: unknown }) => void;
      _setRemoteHolderForTesting: (
        tabId: string,
        heldSince: number,
        lastHeartbeat: number,
      ) => void;
    };

    // Seed a remote holder with a stale heartbeat (20s ago).
    const now = Date.now();
    mod_._setRemoteHolderForTesting('tab-stale', now - 60_000, now - 20_000);

    expect(mod.isRestoreInProgress()).toBe(false); // pruned on read
  });

  it('replies with "state" when another tab queries during an active hold', async () => {
    const mod = await loadFresh();
    const mod_ = mod as typeof mod & {
      _setChannelForTesting: (ch: MockChannel) => void;
      _handleChannelMessageForTesting: (ev: { data: unknown }) => void;
    };

    const mock = makeMockChannel();
    mod_._setChannelForTesting(mock);

    // Acquire so we're in a holding state.
    let release: (() => void) | undefined;
    const heldPromise = mod.withRestoreLock(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    // Reply to another tab's query.
    mod_._handleChannelMessageForTesting({ data: { type: 'query' } });

    const stateCall = mock.postMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { type: string })?.type === 'state',
    );
    expect(stateCall).toBeDefined();
    expect((stateCall![0] as { type: string }).type).toBe('state');

    release?.();
    await heldPromise;
  });

  it('ignores messages whose tabId equals our own tabId', async () => {
    const mod = await loadFresh();
    const mod_ = mod as typeof mod & {
      _getOwnTabIdForTesting: () => string;
      _handleChannelMessageForTesting: (ev: { data: unknown }) => void;
    };

    const ownTabId = mod_._getOwnTabIdForTesting();

    mod_._handleChannelMessageForTesting({
      data: { type: 'acquired', tabId: ownTabId, heldSince: Date.now() },
    });

    expect(mod.isRestoreInProgress()).toBe(false);
  });
});
