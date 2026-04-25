/**
 * Regression: a transient pre-`Promise.race` failure inside `getDB()`'s
 * IIFE must NOT poison `dbPromise`. The next `getDB()` caller must be
 * able to retry and succeed.
 *
 * Background — Devin Review found this on PR #20
 * (BUG_pr-review-job-dd41fe3d6c244bcaa9a1ed88eac14a65_0001). The fix wrapped
 * the `getDB()` body in an IIFE that is assigned synchronously to
 * `dbPromise` so parallel callers in the same tick share one in-flight
 * open. The original `dbPromise = null` reset only ran inside the inner
 * try/catch around `Promise.race(openDBV8WithTimeout(), <timeout>)`. If
 * any line BEFORE that try/catch threw — specifically `await ensureStorage()`,
 * which calls `localStorage.getItem(...)` (raises `SecurityError` on
 * Safari private browsing / sandboxed iframes) — the IIFE rejected but
 * `dbPromise` stayed set to the rejected promise forever. Every later
 * `getDB()` call saw `dbPromise` as truthy (rejected promises ARE truthy),
 * skipped the `if (!dbPromise)` guard, and returned the same stale
 * rejection — permanently breaking offline storage for the rest of the
 * session.
 *
 * The fix-forward wraps the IIFE body in an outer try/catch that resets
 * `dbPromise = null` on ANY failure before re-throwing, restoring the
 * pre-IIFE recovery contract.
 *
 * This test simulates the bug condition by mocking
 * `./mobile-detection.requestPersistentStorage` to throw on the first
 * `getDB()` call and succeed on the retry, then asserts:
 *   1. The first `getDB()` rejects (the failure propagates correctly).
 *   2. The SECOND `getDB()` call succeeds — proving `dbPromise` was
 *      reset to null in the outer catch and the next caller could
 *      install a fresh in-flight promise.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const REAL_DB_NAME = 'rope-works-inspections';

async function deleteRealDB(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(REAL_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe('getDB error recovery (Devin Review BUG_pr-review-job…_0001)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
    await deleteRealDB();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await deleteRealDB();
  });

  it('does NOT permanently poison dbPromise when ensureStorage() throws — next getDB() retries', async () => {
    // Stub mobile-detection so ensureStorage() throws on the first call
    // (mirrors `localStorage.getItem(...)` raising SecurityError on Safari
    // private browsing) and succeeds on the retry.
    let callCount = 0;
    vi.doMock('../mobile-detection', () => ({
      requestPersistentStorage: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new DOMException('Storage access denied', 'SecurityError');
        }
        return true;
      }),
      checkStorageQuota: vi.fn(async () => ({
        usage: 0,
        quota: 100_000_000,
        percentUsed: 0,
      })),
      isMobile: vi.fn(() => false),
    }));

    const { getDB } = await import('../offline-storage');

    // First call: ensureStorage() throws → IIFE outer catch resets
    // dbPromise = null and re-throws. The caller sees the rejection.
    await expect(getDB()).rejects.toThrow(/Storage access denied|SecurityError/);

    // Second call: dbPromise was reset to null by the outer catch, so
    // we re-enter the if-branch with a clean slate. Mock now returns true,
    // so the open succeeds.
    const db = await getDB();
    expect(db).toBeDefined();
    expect(db.name).toBe(REAL_DB_NAME);

    // Sanity: requestPersistentStorage was called twice, proving both
    // entries into the if-branch ran fresh (no cached rejection).
    expect(callCount).toBe(2);
  });

  it('parallel callers all see the rejection but the cache is reset for the next caller', async () => {
    let firstBatchDone = false;
    vi.doMock('../mobile-detection', () => ({
      requestPersistentStorage: vi.fn(async () => {
        if (!firstBatchDone) {
          throw new DOMException('Storage access denied', 'SecurityError');
        }
        return true;
      }),
      checkStorageQuota: vi.fn(async () => ({
        usage: 0,
        quota: 100_000_000,
        percentUsed: 0,
      })),
      isMobile: vi.fn(() => false),
    }));

    const { getDB } = await import('../offline-storage');

    // 3 parallel callers in the same tick — all share the in-flight
    // IIFE promise, all see the same rejection.
    const results = await Promise.allSettled([getDB(), getDB(), getDB()]);
    for (const r of results) {
      expect(r.status).toBe('rejected');
    }

    // Flip the mock so the next call succeeds.
    firstBatchDone = true;

    // After the rejection has fully propagated, dbPromise should be null
    // again, and a fresh getDB() call should succeed.
    const db = await getDB();
    expect(db).toBeDefined();
    expect(db.name).toBe(REAL_DB_NAME);
  });
});
