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

type PhotoDb = Parameters<typeof putPhotoRecord>[0];
type PhotoRecordInput = Parameters<typeof putPhotoRecord>[1];
type StoredPhotoRecord = { id: string; uploaded: number };

let dbCounter = 0;

async function openFreshDb(): Promise<PhotoDb> {
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
  }) as Promise<PhotoDb>;
}

const photoRecord = (id: string, uploaded?: unknown): PhotoRecordInput => ({
  id,
  inspectionId: 'inspection-1',
  uploaded,
});

const storedPhoto = (value: unknown): StoredPhotoRecord => value as StoredPhotoRecord;

const storedPhotos = (values: unknown[]): StoredPhotoRecord[] => values as StoredPhotoRecord[];

describe('N-G — putPhotoRecord funnels every write through toUploadedFlag', () => {

  it('boolean true → stored as number 1', async () => {
    const db = await openFreshDb();
    await putPhotoRecord(db, photoRecord('p1', true));
    const r = storedPhoto(await db.get('photos', 'p1'));
    expect(r.uploaded).toBe(1);
    expect(typeof r.uploaded).toBe('number');
  });

  it('boolean false → stored as number 0', async () => {
    const db = await openFreshDb();
    await putPhotoRecord(db, photoRecord('p2', false));
    const r = storedPhoto(await db.get('photos', 'p2'));
    expect(r.uploaded).toBe(0);
    expect(typeof r.uploaded).toBe('number');
  });

  it('undefined → stored as 0 (not undefined)', async () => {
    const db = await openFreshDb();
    await putPhotoRecord(db, photoRecord('p3'));
    const r = storedPhoto(await db.get('photos', 'p3'));
    expect(r.uploaded).toBe(0);
  });

  it('null → stored as 0', async () => {
    const db = await openFreshDb();
    await putPhotoRecord(db, photoRecord('p4', null));
    const r = storedPhoto(await db.get('photos', 'p4'));
    expect(r.uploaded).toBe(0);
  });

  it('numeric 1 → stored as 1', async () => {
    const db = await openFreshDb();
    await putPhotoRecord(db, photoRecord('p5', 1));
    const r = storedPhoto(await db.get('photos', 'p5'));
    expect(r.uploaded).toBe(1);
  });

  it('numeric 0 → stored as 0', async () => {
    const db = await openFreshDb();
    await putPhotoRecord(db, photoRecord('p6', 0));
    const r = storedPhoto(await db.get('photos', 'p6'));
    expect(r.uploaded).toBe(0);
  });

  it('by-uploaded index remains queryable (the actual C1 regression test)', async () => {
    const db = await openFreshDb();
    // Mixed-shape inputs that previously broke the index.
    await putPhotoRecord(db, photoRecord('a', false));   // 0
    await putPhotoRecord(db, photoRecord('b', undefined)); // 0
    await putPhotoRecord(db, photoRecord('c', true));    // 1
    await putPhotoRecord(db, photoRecord('d', 1));       // 1

    const unuploaded = storedPhotos(await db.getAllFromIndex(
      'photos',
      'by-uploaded',
      IDBKeyRange.only(0),
    ));
    const uploaded = storedPhotos(await db.getAllFromIndex(
      'photos',
      'by-uploaded',
      IDBKeyRange.only(1),
    ));
    expect(unuploaded.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(uploaded.map((r) => r.id).sort()).toEqual(['c', 'd']);
  });

  it('does not mutate the caller-supplied object', async () => {
    const db = await openFreshDb();
    const input = photoRecord('p7', false);
    await putPhotoRecord(db, input);
    // input should still hold the original boolean — coercion must happen
    // only on the value written into IDB.
    expect(input.uploaded).toBe(false);
  });
});
