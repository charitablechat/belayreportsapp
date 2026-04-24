/**
 * Coverage for N-H (tab-crash safety for the restore lock).
 *
 * The in-memory ref-count alone is lost if the tab crashes (iOS memory
 * pressure, user swipe-closing a PWA, OS-level kill). The next launch sees
 * `_restoreCount = 0` and auto-sync would immediately push any half-written
 * `synced_at = null` rows that the restore left behind.
 *
 * Fix: persist a timestamp + epoch to sessionStorage on acquire and clear
 * it on release. On module load, a recent lingering entry (< 15 minutes
 * old) blocks sync; older entries are self-healing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const PERSIST_KEY = 'restore-lock-v1';

async function loadFresh() {
  vi.resetModules();
  return await import('../restore-lock');
}

describe('N-H — restore-lock crash safety', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it('writes a sessionStorage sentinel on acquire and clears it on release', async () => {
    const { withRestoreLock } = await loadFresh();

    await withRestoreLock(async () => {
      const raw = sessionStorage.getItem(PERSIST_KEY);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(typeof parsed.heldSince).toBe('number');
      expect(typeof parsed.epoch).toBe('number');
    });

    // After normal release, sentinel is cleared.
    expect(sessionStorage.getItem(PERSIST_KEY)).toBeNull();
  });

  it('clears the sentinel even when fn throws', async () => {
    const { withRestoreLock } = await loadFresh();

    await expect(
      withRestoreLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(sessionStorage.getItem(PERSIST_KEY)).toBeNull();
  });

  it('isRestoreInProgress returns true if a recent sentinel is present at load (simulating tab crash)', async () => {
    // Simulate a crash mid-restore: the sentinel exists but no lock is held
    // in this fresh module load.
    sessionStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({
        heldSince: Date.now() - 60 * 1000, // 1 min ago
        epoch: 1,
      }),
    );

    const { isRestoreInProgress } = await loadFresh();
    expect(isRestoreInProgress()).toBe(true);
  });

  it('isRestoreInProgress auto-evicts stale sentinels older than 15 minutes', async () => {
    sessionStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({
        heldSince: Date.now() - 20 * 60 * 1000, // 20 min ago — stale
        epoch: 7,
      }),
    );

    const { isRestoreInProgress } = await loadFresh();
    expect(isRestoreInProgress()).toBe(false);
    // Auto-evicted on read.
    expect(sessionStorage.getItem(PERSIST_KEY)).toBeNull();
  });

  it('returns false with no in-memory lock and no sentinel', async () => {
    const { isRestoreInProgress } = await loadFresh();
    expect(isRestoreInProgress()).toBe(false);
  });

  it('epoch increments when a new acquire follows a crashed prior session', async () => {
    // Simulate a prior crashed session by pre-seeding the sentinel with an
    // epoch > 0. The next acquire should bump the epoch (clean release
    // clears the sentinel, so we verify the bump against a pre-seeded one).
    sessionStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({
        heldSince: Date.now() - 60 * 1000,
        epoch: 5,
      }),
    );

    const { withRestoreLock } = await loadFresh();
    let observedEpoch = 0;
    await withRestoreLock(async () => {
      observedEpoch = JSON.parse(sessionStorage.getItem(PERSIST_KEY)!).epoch;
    });

    expect(observedEpoch).toBe(6);
  });

  it('clearPersistedRestoreLock removes a lingering sentinel', async () => {
    sessionStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ heldSince: Date.now(), epoch: 1 }),
    );
    const { clearPersistedRestoreLock, isRestoreInProgress } = await loadFresh();
    expect(isRestoreInProgress()).toBe(true);
    clearPersistedRestoreLock();
    expect(sessionStorage.getItem(PERSIST_KEY)).toBeNull();
    expect(isRestoreInProgress()).toBe(false);
  });

  it('nested acquires share a single sentinel write (ref-count behaviour preserved)', async () => {
    const { withRestoreLock } = await loadFresh();

    const writes: string[] = [];
    const original = sessionStorage.setItem.bind(sessionStorage);
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === PERSIST_KEY) writes.push(value);
        return original(key, value);
      });

    await withRestoreLock(async () => {
      await withRestoreLock(async () => {
        // inner lock
      });
    });

    // Exactly one write on acquire; the inner acquire must NOT re-write.
    expect(writes.length).toBe(1);
    expect(sessionStorage.getItem(PERSIST_KEY)).toBeNull(); // cleared on final release

    spy.mockRestore();
  });
});
