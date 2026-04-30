/**
 * Audit M1: extend the iOS 18.7 Mobile Safari `InvalidStateError: The
 * database connection is closing` coverage from `cleanupStaleCachedPhotos`
 * (PR #66) to its three sibling helpers:
 *
 *   - isCachedPhotoValid
 *   - validateCachedPhoto
 *   - batchValidateCachedPhotos
 *
 * Each is called from `PhotoGallery` / `PhotoCapture` (sometimes on every
 * render, sometimes from a fire-and-forget effect). On iOS Safari they
 * can race the same lifecycle close PR #66 hardened cleanup against. The
 * guards must:
 *
 *   1. Skip work entirely when the page is hidden.
 *   2. Catch `InvalidStateError` at `getDB()`, at `db.get()`, or inside
 *      the cursor walk and return a graceful fallback (`false` /
 *      empty / partial set), not throw.
 *   3. Re-throw non-closing errors so genuine bugs still surface.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDB } from 'idb';
import {
  isCachedPhotoValid,
  validateCachedPhoto,
  batchValidateCachedPhotos,
  __setGetDBForPhotoCacheForTesting,
} from '../photo-cache';

let dbCounter = 0;

async function openFreshDb() {
  const name = `test-photo-cache-siblings-${dbCounter++}`;
  return openDB(name, 1, {
    upgrade(db) {
      const store = db.createObjectStore('photos', { keyPath: 'id' });
      store.createIndex('by-uploaded', 'uploaded');
    },
  });
}

function makePhoto(id: string, ageMs: number) {
  return {
    id,
    inspectionId: 'insp-1',
    section: 'systems',
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    fileName: `${id}.jpg`,
    timestamp: Date.now(),
    uploaded: 1,
    photoUrl: `http://example/${id}.jpg`,
    cachedAt: Date.now() - ageMs,
    lastValidated: Date.now() - ageMs,
  };
}

function makeInvalidStateError(at: string): Error {
  const err = new Error(`Failed to execute '${at}' on 'IDBDatabase': The database connection is closing.`);
  err.name = 'InvalidStateError';
  return err;
}

describe('photo-cache sibling guards (audit M1) — iOS Safari IDB closing', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    __setGetDBForPhotoCacheForTesting(null);
    vi.restoreAllMocks();
  });

  describe('isCachedPhotoValid', () => {
    it('returns true for a fresh cached photo', async () => {
      const db = await openFreshDb();
      await db.put('photos', makePhoto('p1', 60_000));
      __setGetDBForPhotoCacheForTesting(async () => db as never);
      await expect(isCachedPhotoValid('p1')).resolves.toBe(true);
      db.close();
    });

    it('returns false for a stale cached photo', async () => {
      const db = await openFreshDb();
      await db.put('photos', makePhoto('p1', 25 * 60 * 60 * 1000));
      __setGetDBForPhotoCacheForTesting(async () => db as never);
      await expect(isCachedPhotoValid('p1')).resolves.toBe(false);
      db.close();
    });

    it('returns false (no throw) when getDB rejects with InvalidStateError', async () => {
      __setGetDBForPhotoCacheForTesting(async () => {
        throw makeInvalidStateError('open');
      });
      await expect(isCachedPhotoValid('p1')).resolves.toBe(false);
    });

    it('returns false (no throw) when db.get rejects with InvalidStateError', async () => {
      const fakeDb = {
        get: () => Promise.reject(makeInvalidStateError('get')),
      };
      __setGetDBForPhotoCacheForTesting(async () => fakeDb as never);
      await expect(isCachedPhotoValid('p1')).resolves.toBe(false);
    });

    it('skips work entirely when document.visibilityState === "hidden"', async () => {
      const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      const getDbSpy = vi.fn();
      __setGetDBForPhotoCacheForTesting(getDbSpy as never);
      await expect(isCachedPhotoValid('p1')).resolves.toBe(false);
      expect(getDbSpy).not.toHaveBeenCalled();
      visibilitySpy.mockRestore();
    });

    it('re-throws non-closing errors so genuine bugs surface', async () => {
      __setGetDBForPhotoCacheForTesting(async () => {
        throw new Error('quota_exceeded');
      });
      await expect(isCachedPhotoValid('p1')).rejects.toThrow('quota_exceeded');
    });
  });

  describe('validateCachedPhoto', () => {
    it('returns true and bumps lastValidated on a fresh photo', async () => {
      const db = await openFreshDb();
      const before = Date.now() - 60_000;
      await db.put('photos', { ...makePhoto('p1', 60_000), lastValidated: before });
      __setGetDBForPhotoCacheForTesting(async () => db as never);
      await expect(validateCachedPhoto('p1')).resolves.toBe(true);
      const after = await db.get('photos', 'p1');
      expect(after?.lastValidated).toBeGreaterThan(before);
      db.close();
    });

    it('returns true even when the lastValidated write throws InvalidStateError mid-write', async () => {
      const db = await openFreshDb();
      await db.put('photos', makePhoto('p1', 60_000));
      let calls = 0;
      const fakeDb = {
        get: (store: string, id: string) => {
          calls++;
          // First call (from isCachedPhotoValid) succeeds; second call
          // (from inside validateCachedPhoto's lastValidated write) throws.
          if (calls === 2) return Promise.reject(makeInvalidStateError('get'));
          return db.get(store as 'photos', id);
        },
        put: () => Promise.resolve('p1'),
      };
      __setGetDBForPhotoCacheForTesting(async () => fakeDb as never);
      await expect(validateCachedPhoto('p1')).resolves.toBe(true);
      db.close();
    });

    it('returns false for a stale photo without trying to write', async () => {
      const db = await openFreshDb();
      await db.put('photos', makePhoto('p1', 25 * 60 * 60 * 1000));
      const putSpy = vi.fn(db.put.bind(db));
      const wrappedDb = { ...db, get: db.get.bind(db), put: putSpy };
      __setGetDBForPhotoCacheForTesting(async () => wrappedDb as never);
      await expect(validateCachedPhoto('p1')).resolves.toBe(false);
      expect(putSpy).not.toHaveBeenCalled();
      db.close();
    });

    it('returns false (no throw) when isCachedPhotoValid rejects with InvalidStateError', async () => {
      __setGetDBForPhotoCacheForTesting(async () => {
        throw makeInvalidStateError('open');
      });
      await expect(validateCachedPhoto('p1')).resolves.toBe(false);
    });

    it('skips work entirely when document.visibilityState === "hidden"', async () => {
      const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      const getDbSpy = vi.fn();
      __setGetDBForPhotoCacheForTesting(getDbSpy as never);
      await expect(validateCachedPhoto('p1')).resolves.toBe(false);
      expect(getDbSpy).not.toHaveBeenCalled();
      visibilitySpy.mockRestore();
    });
  });

  describe('batchValidateCachedPhotos', () => {
    it('returns the set of fresh ids and skips stale ones', async () => {
      const db = await openFreshDb();
      await db.put('photos', makePhoto('p1', 60_000));
      await db.put('photos', makePhoto('p2', 25 * 60 * 60 * 1000));
      await db.put('photos', makePhoto('p3', 30_000));
      __setGetDBForPhotoCacheForTesting(async () => db as never);
      const result = await batchValidateCachedPhotos(['p1', 'p2', 'p3']);
      expect([...result].sort()).toEqual(['p1', 'p3']);
      db.close();
    });

    it('returns an empty set for an empty input list (without opening db)', async () => {
      const getDbSpy = vi.fn();
      __setGetDBForPhotoCacheForTesting(getDbSpy as never);
      await expect(batchValidateCachedPhotos([])).resolves.toEqual(new Set());
      expect(getDbSpy).not.toHaveBeenCalled();
    });

    it('skips work entirely when document.visibilityState === "hidden"', async () => {
      const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      const getDbSpy = vi.fn();
      __setGetDBForPhotoCacheForTesting(getDbSpy as never);
      await expect(batchValidateCachedPhotos(['p1'])).resolves.toEqual(new Set());
      expect(getDbSpy).not.toHaveBeenCalled();
      visibilitySpy.mockRestore();
    });

    it('returns empty set (no throw) when getDB rejects with InvalidStateError', async () => {
      __setGetDBForPhotoCacheForTesting(async () => {
        throw makeInvalidStateError('open');
      });
      await expect(batchValidateCachedPhotos(['p1'])).resolves.toEqual(new Set());
    });

    it('returns partial set (no throw) when the cursor walk aborts mid-iteration', async () => {
      const db = await openFreshDb();
      await db.put('photos', makePhoto('p1', 60_000));
      await db.put('photos', makePhoto('p2', 60_000));
      await db.put('photos', makePhoto('p3', 60_000));

      // Fake db whose tx.store.get works for p1 then throws for p2.
      let getCalls = 0;
      const fakeTx = {
        store: {
          get: (id: string) => {
            getCalls++;
            if (getCalls === 1) return Promise.resolve(makePhoto(id, 60_000));
            return Promise.reject(makeInvalidStateError('get'));
          },
        },
        done: Promise.reject(makeInvalidStateError('done')),
      };
      // Silence unhandled rejection from the precomputed `done` promise we
      // pass through (the production code attaches a noop catch handler).
      fakeTx.done.catch(() => {});
      const fakeDb = {
        transaction: () => fakeTx,
      };
      __setGetDBForPhotoCacheForTesting(async () => fakeDb as never);

      const result = await batchValidateCachedPhotos(['p1', 'p2', 'p3']);
      expect([...result]).toEqual(['p1']);
      db.close();
    });

    it('attaches a no-throw catch to tx.done so its abort-rejection is not unhandled', async () => {
      const db = await openFreshDb();
      await db.put('photos', makePhoto('p1', 60_000));
      const unhandled: unknown[] = [];
      const handler = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', handler);

      // tx.done is a Promise that rejects with InvalidStateError. The cursor
      // walk also throws so we exit the inner try/catch. The outer code
      // returns the partial set and we want NO unhandled rejection.
      const fakeTx = {
        store: {
          get: () => Promise.reject(makeInvalidStateError('get')),
        },
        done: Promise.reject(makeInvalidStateError('done')),
      };
      fakeTx.done.catch(() => {}); // local silencer; production also attaches one
      const fakeDb = {
        transaction: () => fakeTx,
      };
      __setGetDBForPhotoCacheForTesting(async () => fakeDb as never);

      await expect(batchValidateCachedPhotos(['p1'])).resolves.toEqual(new Set());
      // Yield a microtask for any late rejections to surface.
      await new Promise((r) => setTimeout(r, 10));
      process.off('unhandledRejection', handler);
      expect(unhandled).toEqual([]);
      db.close();
    });
  });
});
