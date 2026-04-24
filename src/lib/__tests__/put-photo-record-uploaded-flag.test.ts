/**
 * Coverage for N-G (centralised photo write helper) in `src/lib/offline-storage.ts`.
 *
 * Any photo write that bypasses `toUploadedFlag` silently regresses the C1
 * fix on spec-strict IDB (Safari/iOS) — a boolean `uploaded: false` is dropped
 * from the `by-uploaded` index, so the photo never surfaces to `syncPhotos`.
 *
 * These tests lock:
 * 1. `putPhotoRecord` coerces any truthy value to 1.
 * 2. `putPhotoRecord` coerces any falsy value to 0.
 * 3. `undefined`/`null` inputs coerce to 0 (not `undefined`).
 *
 * They run against a spec-strict in-memory IDB (fake-indexeddb) so behaviour
 * matches Safari, not the more forgiving Chromium engine.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openDB } from 'idb';
import { putPhotoRecord } from '../offline-storage';

let dbCounter = 0;

async function openFreshDb() {
  // Fresh DB per test avoids holding connections open across tests, which
  // would otherwise cause `indexedDB.deleteDatabase` to block indefinitely
  // in fake-indexeddb. Each test gets its own DB name and closes the
  // connection at the end.
  const name = `test-put-photo-record-${dbCounter++}`;
  return openDB(name, 1, {
    upgrade(db) {
      const store = db.createObjectStore('photos', { keyPath: 'id' });
      store.createIndex('by-uploaded', 'uploaded');
    },
  });
}

describe('N-G — putPhotoRecord funnels every write through toUploadedFlag', () => {

  it('boolean true → stored as number 1', async () => {
    const db: any = await openFreshDb();
    await putPhotoRecord(db, { id: 'p1', uploaded: true } as any);
    const r = await db.get('photos', 'p1');
    expect(r.uploaded).toBe(1);
    expect(typeof r.uploaded).toBe('number');
  });

  it('boolean false → stored as number 0', async () => {
    const db: any = await openFreshDb();
    await putPhotoRecord(db, { id: 'p2', uploaded: false } as any);
    const r = await db.get('photos', 'p2');
    expect(r.uploaded).toBe(0);
    expect(typeof r.uploaded).toBe('number');
  });

  it('undefined → stored as 0 (not undefined)', async () => {
    const db: any = await openFreshDb();
    await putPhotoRecord(db, { id: 'p3' } as any);
    const r = await db.get('photos', 'p3');
    expect(r.uploaded).toBe(0);
  });

  it('null → stored as 0', async () => {
    const db: any = await openFreshDb();
    await putPhotoRecord(db, { id: 'p4', uploaded: null } as any);
    const r = await db.get('photos', 'p4');
    expect(r.uploaded).toBe(0);
  });

  it('numeric 1 → stored as 1', async () => {
    const db: any = await openFreshDb();
    await putPhotoRecord(db, { id: 'p5', uploaded: 1 } as any);
    const r = await db.get('photos', 'p5');
    expect(r.uploaded).toBe(1);
  });

  it('numeric 0 → stored as 0', async () => {
    const db: any = await openFreshDb();
    await putPhotoRecord(db, { id: 'p6', uploaded: 0 } as any);
    const r = await db.get('photos', 'p6');
    expect(r.uploaded).toBe(0);
  });

  it('by-uploaded index remains queryable (the actual C1 regression test)', async () => {
    const db: any = await openFreshDb();
    // Mixed-shape inputs that previously broke the index.
    await putPhotoRecord(db, { id: 'a', uploaded: false } as any);   // 0
    await putPhotoRecord(db, { id: 'b', uploaded: undefined } as any); // 0
    await putPhotoRecord(db, { id: 'c', uploaded: true } as any);    // 1
    await putPhotoRecord(db, { id: 'd', uploaded: 1 } as any);       // 1

    const unuploaded = await db.getAllFromIndex(
      'photos',
      'by-uploaded',
      IDBKeyRange.only(0),
    );
    const uploaded = await db.getAllFromIndex(
      'photos',
      'by-uploaded',
      IDBKeyRange.only(1),
    );
    expect(unuploaded.map((r: any) => r.id).sort()).toEqual(['a', 'b']);
    expect(uploaded.map((r: any) => r.id).sort()).toEqual(['c', 'd']);
  });

  it('does not mutate the caller-supplied object', async () => {
    const db: any = await openFreshDb();
    const input = { id: 'p7', uploaded: false as unknown };
    await putPhotoRecord(db, input);
    // input should still hold the original boolean — coercion must happen
    // only on the value written into IDB.
    expect(input.uploaded).toBe(false);
  });
});
