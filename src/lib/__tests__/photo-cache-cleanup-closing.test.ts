/**
 * Coverage for the iOS 18.7 Mobile Safari `InvalidStateError: The database
 * connection is closing` failure mode in `cleanupStaleCachedPhotos`.
 *
 * The cleanup runs on App mount + on a 1-hour interval. On iOS Safari, a
 * tab being backgrounded / the page entering bfcache / phone lock will close
 * the IDB connection asynchronously. The error has been observed both:
 *   1. At `db.transaction(...)` call time (closed before we even start).
 *   2. Inside the cursor walk (closed mid-iteration).
 *
 * Both paths must fail soft — the function is fire-and-forget from `App.tsx`
 * and an unhandled rejection produces the user-visible crash report.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDB } from 'idb';
import {
  cleanupStaleCachedPhotos,
  __setGetDBForCleanupForTesting,
} from '../photo-cache';

let dbCounter = 0;

async function openFreshDb() {
  const name = `test-photo-cache-cleanup-${dbCounter++}`;
  return openDB(name, 1, {
    upgrade(db) {
      const store = db.createObjectStore('photos', { keyPath: 'id' });
      store.createIndex('by-uploaded', 'uploaded');
    },
  });
}

function makeStalePhoto(id: string) {
  return {
    id,
    inspectionId: 'insp-1',
    section: 'systems',
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    fileName: `${id}.jpg`,
    timestamp: Date.now(),
    uploaded: 1,
    photoUrl: `http://example/${id}.jpg`,
    cachedAt: Date.now() - (25 * 60 * 60 * 1000), // > 24h old
    lastValidated: Date.now() - (25 * 60 * 60 * 1000),
  };
}

describe('cleanupStaleCachedPhotos — iOS Safari closing-connection guard', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    __setGetDBForCleanupForTesting(null);
    vi.restoreAllMocks();
  });

  it('happy path: deletes stale entries when the connection is healthy', async () => {
    const db = await openFreshDb();
    await db.put('photos', makeStalePhoto('p1'));
    await db.put('photos', makeStalePhoto('p2'));
    // Fresh photo — should NOT be deleted.
    await db.put('photos', { ...makeStalePhoto('p3'), cachedAt: Date.now() });

    __setGetDBForCleanupForTesting(async () => db as never);

    const cleaned = await cleanupStaleCachedPhotos();
    expect(cleaned).toBe(2);

    const remaining = await db.getAll('photos');
    expect(remaining.map((p) => p.id).sort()).toEqual(['p3']);

    db.close();
  });

  it('returns 0 without throwing when getDB rejects (e.g. circuit breaker tripped)', async () => {
    __setGetDBForCleanupForTesting(async () => {
      throw new Error('idb_unhealthy');
    });

    const cleaned = await cleanupStaleCachedPhotos();
    expect(cleaned).toBe(0);
  });

  it('returns 0 without throwing when db.transaction throws InvalidStateError up front', async () => {
    // Simulate the iOS path where the connection has already transitioned to
    // "closing" by the time the caller tries to open a transaction.
    const fakeDb = {
      transaction: vi.fn(() => {
        const err = new Error('Failed to execute \'transaction\' on \'IDBDatabase\': The database connection is closing');
        (err as Error & { name: string }).name = 'InvalidStateError';
        throw err;
      }),
    };
    __setGetDBForCleanupForTesting(async () => fakeDb as never);

    const cleaned = await cleanupStaleCachedPhotos();
    expect(cleaned).toBe(0);
    expect(fakeDb.transaction).toHaveBeenCalledTimes(1);
  });

  it('returns partial count and does not throw when the cursor walk throws InvalidStateError mid-iteration', async () => {
    // Simulate iOS bfcache hitting between the first delete and the next
    // cursor.continue(). The first delete has already committed; the rest
    // should be left for the next hourly tick.
    const fakeStore = {
      openCursor: vi.fn(async () => {
        let calls = 0;
        const cursor = {
          value: makeStalePhoto('p1'),
          delete: vi.fn(async () => undefined),
          continue: vi.fn(async () => {
            calls++;
            if (calls === 1) {
              const err = new Error('The database connection is closing');
              (err as Error & { name: string }).name = 'InvalidStateError';
              throw err;
            }
            return null;
          }),
        };
        return cursor;
      }),
    };
    const fakeTx = {
      store: fakeStore,
      done: Promise.resolve(),
      abort: vi.fn(),
    };
    const fakeDb = {
      transaction: vi.fn(() => fakeTx),
    };
    __setGetDBForCleanupForTesting(async () => fakeDb as never);

    const cleaned = await cleanupStaleCachedPhotos();
    expect(cleaned).toBe(1);
    expect(fakeTx.abort).toHaveBeenCalled();
  });

  it('attaches a catch handler to tx.done so its abort-rejection does not surface as an unhandled rejection', async () => {
    // Regression: prior to attaching `tx.done.catch(() => {})` in the
    // mid-walk error path, the `idb` wrapper's `tx.done` would reject on
    // abort with no listener — surfacing as an unhandled-rejection
    // (the exact symptom the user reported on iOS 18.7).
    let txDoneRejected = false;
    const fakeTxDone = new Promise<void>((_, reject) => {
      // Reject async so the catch handler must be attached BEFORE the
      // rejection lands in the microtask queue. If `cleanupStaleCachedPhotos`
      // doesn't attach a handler, this becomes an unhandled rejection.
      setTimeout(() => {
        txDoneRejected = true;
        reject(new Error('AbortError: transaction was aborted'));
      }, 0);
    });

    const fakeStore = {
      openCursor: vi.fn(async () => {
        const err = new Error('The database connection is closing');
        (err as Error & { name: string }).name = 'InvalidStateError';
        throw err;
      }),
    };
    const fakeTx = {
      store: fakeStore,
      done: fakeTxDone,
      abort: vi.fn(),
    };
    const fakeDb = {
      transaction: vi.fn(() => fakeTx),
    };
    __setGetDBForCleanupForTesting(async () => fakeDb as never);

    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);

    try {
      const cleaned = await cleanupStaleCachedPhotos();
      expect(cleaned).toBe(0);
      // Give the microtask queue + the setTimeout(0) above time to flush
      // so we can observe whether tx.done's rejection was caught.
      await new Promise((r) => setTimeout(r, 10));
      expect(txDoneRejected).toBe(true);
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('skips work entirely when document.visibilityState === "hidden"', async () => {
    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    const fakeDb = {
      transaction: vi.fn(),
    };
    __setGetDBForCleanupForTesting(async () => fakeDb as never);

    try {
      const cleaned = await cleanupStaleCachedPhotos();
      expect(cleaned).toBe(0);
      // Critical: we never even open a transaction on a hidden tab.
      expect(fakeDb.transaction).not.toHaveBeenCalled();
    } finally {
      if (original) {
        Object.defineProperty(Document.prototype, 'visibilityState', original);
      } else {
        // @ts-expect-error - cleanup the test override
        delete document.visibilityState;
      }
    }
  });

  it('non-closing errors are also swallowed (no unhandled rejection)', async () => {
    const fakeDb = {
      transaction: vi.fn(() => {
        throw new Error('something else entirely');
      }),
    };
    __setGetDBForCleanupForTesting(async () => fakeDb as never);

    // Must resolve, not reject.
    const cleaned = await cleanupStaleCachedPhotos();
    expect(cleaned).toBe(0);
  });
});
