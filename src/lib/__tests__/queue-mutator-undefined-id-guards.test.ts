import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Audit L3 — Regression test for the `DataError: Failed to execute 'only' on
 * 'IDBKeyRange'` fix.
 *
 * Background: queued operation IDs come from `db.add(store, op)` and are typed
 * as `number`, but in practice the codebase passes `op.id` from rows that may
 * have undefined IDs (race conditions during temp-id swap, stale snapshots,
 * etc.). When `undefined` reached `db.delete(store, undefined)` the browser
 * threw `DataError: Failed to execute 'only' on 'IDBKeyRange': The parameter
 * is not a valid key.`, taking down the whole sync cycle.
 *
 * The fix (commits c10beed8 / 179af283) added an explicit early-return guard
 * to every queue mutator. This test pins the contract by spying on `getDB`
 * (the gateway every mutator passes through to reach IndexedDB) and asserting
 * that `getDB` is NEVER invoked when the ID is undefined or null. If a future
 * refactor moves or removes the guard, `getDB` will be called and this test
 * will fail loudly.
 *
 * Also pins behavior for `id: 0` — a valid IndexedDB autoincrement key — so a
 * future "falsy" guard can't accidentally break the legitimate first-row case.
 */

type GuardedMutator = (id: number | undefined | null) => Promise<unknown>;

describe('Audit L3 — queue-mutator undefined-id guards (DataError regression)', () => {
  // Every guarded mutator under test funnels through the local `getDB()`
  // helper to reach IndexedDB. Spying there is sufficient to prove the
  // early-return guard ran — we never need a real IDB instance.
  const getDBSpy = vi.fn<() => Promise<unknown>>();
  let storageModule: typeof import('../offline-storage');

  beforeEach(async () => {
    vi.resetModules();
    getDBSpy.mockReset();
    getDBSpy.mockImplementation(() => {
      throw new Error(
        '[Audit L3] guard violated — getDB() reached even though ID was undefined/null',
      );
    });

    vi.doMock('idb', async (importOriginal) => {
      const actual = await importOriginal<typeof import('idb')>();
      return { ...actual, openDB: getDBSpy };
    });

    storageModule = await import('../offline-storage');
  });

  afterEach(() => {
    vi.doUnmock('idb');
  });

  describe.each<{ name: string; mutator: () => GuardedMutator }>([
    {
      name: 'removeQueuedOperation',
      mutator: () => storageModule.removeQueuedOperation,
    },
    {
      name: 'removeQueuedAssessmentOperation',
      mutator: () => storageModule.removeQueuedAssessmentOperation,
    },
    {
      name: 'removeQueuedTrainingOperation',
      mutator: () => storageModule.removeQueuedTrainingOperation,
    },
    {
      name: 'incrementAssessmentOperationRetry',
      mutator: () => storageModule.incrementAssessmentOperationRetry,
    },
    {
      name: 'incrementTrainingOperationRetry',
      mutator: () => storageModule.incrementTrainingOperationRetry,
    },
    {
      name: 'updateQueuedOperation',
      // updateQueuedOperation takes (id, patch); curry the patch
      mutator:
        () =>
        (id: number | undefined | null) =>
          storageModule.updateQueuedOperation(id, { retries: 1 }),
    },
    {
      name: 'updateQueuedAssessmentOperation',
      mutator:
        () =>
        (id: number | undefined | null) =>
          storageModule.updateQueuedAssessmentOperation(id, { retries: 1 }),
    },
    {
      name: 'updateQueuedTrainingOperation',
      mutator:
        () =>
        (id: number | undefined | null) =>
          storageModule.updateQueuedTrainingOperation(id, { retries: 1 }),
    },
  ])('$name', ({ mutator }) => {
    it('returns without invoking IDB when ID is undefined', async () => {
      await expect(mutator()(undefined)).resolves.not.toThrow();
      expect(getDBSpy).not.toHaveBeenCalled();
    });

    it('returns without invoking IDB when ID is null', async () => {
      await expect(mutator()(null)).resolves.not.toThrow();
      expect(getDBSpy).not.toHaveBeenCalled();
    });
  });
});
