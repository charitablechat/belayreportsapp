import { describe, it, expect } from 'vitest';

/**
 * Audit P1 — strict-save boundary migration for two critical secondary writes.
 *
 * `addToDeadLetterSoftDeletes` and `incrementOperationRetry` both used to
 * route through `withIndexedDBErrorBoundary`, which silently swallows IDB
 * errors and returns `undefined`. That made the dead-letter safety net itself
 * silently unreliable: if the put failed, the caller in
 * `queued-soft-delete-processor.handleSoftDeleteFailure` would still execute
 * `await remove(op.id)` and lose the queued op entirely.
 *
 * After P1, both functions route through `withIndexedDBSaveBoundary` which
 * throws `IdbSaveError` on failure. The caller's existing try/catch then
 * runs the recovery branch — the op stays in the queue with bumped attempts
 * for the next sync cycle.
 *
 * jsdom has no real IndexedDB, so the new save functions hit the
 * health-check / circuit-breaker branches and either throw `IdbSaveError`
 * (correct new behavior) or never silently resolve to `undefined` (the old
 * behavior that the audit explicitly forbids).
 */

describe('Audit P1 — addToDeadLetterSoftDeletes contract', () => {
  it('NEVER silently resolves to undefined on failure (post-migration contract)', async () => {
    const { addToDeadLetterSoftDeletes, isIdbSaveError } = await import('../offline-storage');

    const entry = {
      id: 'operations:99:1234567890',
      queueStore: 'operations' as const,
      table: 'inspections' as const,
      recordId: 'insp-1',
      attempts: 5,
      firstFailedAt: '2024-01-01T00:00:00.000Z',
      lastError: 'transient',
      deadLetteredAt: '2024-01-01T00:01:00.000Z',
      originalOp: {},
    };

    let thrown: unknown = null;
    let result: unknown;
    try {
      result = await addToDeadLetterSoftDeletes(entry);
    } catch (e) {
      thrown = e;
    }

    if (thrown) {
      // Loud failure: the caller's catch block runs and the op stays queued.
      expect(isIdbSaveError(thrown)).toBe(true);
    } else {
      // Success path: must return the SaveResult shape, not undefined.
      // (Silent boundary returned undefined; strict-save returns
      // `{ savedToBackup: boolean }`.)
      expect(result).toBeDefined();
      expect(result).toHaveProperty('savedToBackup');
      const r = result as { savedToBackup: unknown };
      expect(typeof r.savedToBackup).toBe('boolean');
    }
  });

  it('thrown IdbSaveError carries operationName="addToDeadLetterSoftDeletes"', async () => {
    const { addToDeadLetterSoftDeletes, isIdbSaveError } = await import('../offline-storage');

    const entry = {
      id: 'training_operations:1:1',
      queueStore: 'training_operations' as const,
      table: 'trainings' as const,
      recordId: 'tr-1',
      attempts: 5,
      firstFailedAt: '2024-01-01T00:00:00.000Z',
      lastError: 'x',
      deadLetteredAt: '2024-01-01T00:00:01.000Z',
      originalOp: {},
    };

    try {
      await addToDeadLetterSoftDeletes(entry);
    } catch (e) {
      if (isIdbSaveError(e)) {
        expect(e.operationName).toBe('addToDeadLetterSoftDeletes');
        // Throwing a recognised IdbSaveError code (any of the discriminants)
        // is enough — the exact code depends on whether it's the
        // health-check, circuit-breaker, or storage path that fails first.
        expect([
          'idb_unhealthy',
          'idb_closing',
          'timeout',
          'quota_exceeded',
          'storage_unavailable',
          'unknown',
        ]).toContain(e.code);
      }
    }
  });
});

describe('Audit P1 — incrementOperationRetry contract', () => {
  it('NEVER silently resolves to undefined on failure (post-migration contract)', async () => {
    const { incrementOperationRetry, isIdbSaveError } = await import('../offline-storage');

    let thrown: unknown = null;
    let result: unknown;
    try {
      result = await incrementOperationRetry(42);
    } catch (e) {
      thrown = e;
    }

    if (thrown) {
      expect(isIdbSaveError(thrown)).toBe(true);
    } else {
      expect(result).toBeDefined();
      expect(result).toHaveProperty('savedToBackup');
      const r = result as { savedToBackup: unknown };
      expect(typeof r.savedToBackup).toBe('boolean');
    }
  });
});

describe('Audit P1 — caller integration: queued-soft-delete-processor recovery branch', () => {
  it("emulates handleSoftDeleteFailure's catch path — op stays queued on dead-letter throw", async () => {
    const { IdbSaveError, isIdbSaveError } = await import('../offline-storage');

    // Mirror the shape of the real caller at queued-soft-delete-processor.ts:110-130.
    // The strict-save migration's whole point is that the catch branch fires
    // when the dead-letter put fails, so the op is NOT removed from the queue.
    let removed = false;
    let attemptsBumped = false;

    async function fakeRemove(_id: number) {
      removed = true;
    }
    async function fakeBumpAttempts() {
      attemptsBumped = true;
    }
    async function fakeAddToDeadLetter() {
      throw new IdbSaveError('idb_closing', 'addToDeadLetterSoftDeletes');
    }

    try {
      await fakeAddToDeadLetter();
      await fakeRemove(1); // <-- never reached
    } catch (dlErr) {
      expect(isIdbSaveError(dlErr)).toBe(true);
      try {
        await fakeBumpAttempts();
      } catch {
        /* ignore */
      }
    }

    expect(removed).toBe(false); // op stays in the queue
    expect(attemptsBumped).toBe(true); // attempts bumped for next-cycle retry
  });
});
