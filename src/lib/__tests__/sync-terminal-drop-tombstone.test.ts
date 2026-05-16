import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.get(k) ?? null; }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

beforeEach(async () => {
  (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();
  const { vi } = await import('vitest');
  vi.resetModules();
});

describe('Sync Terminal DROP tombstone — durable suppression contract', () => {
  it('forceDeleteLocalRecord tombstones the id; future getUnsyncedTrainings hides it even if IDB row resurfaces', async () => {
    const {
      saveTrainingOffline,
      getUnsyncedTrainings,
      forceDeleteLocalRecord,
      isIdbReadFailure,
    } = await import('../offline-storage');

    await saveTrainingOffline({ id: 'trn-drop-1', inspector_id: 'u1', organization: 'Acme' });
    let rows = await getUnsyncedTrainings('u1');
    expect(isIdbReadFailure(rows)).toBe(false);
    expect((rows as Array<{ id: string }>).map(r => r.id)).toContain('trn-drop-1');

    await forceDeleteLocalRecord('trainings', 'trn-drop-1');
    rows = await getUnsyncedTrainings('u1');
    expect((rows as Array<{ id: string }>).map(r => r.id)).not.toContain('trn-drop-1');

    // Simulate a server-refetch / Realtime resurrection writing the row back.
    // Manually put the row (bypass saveTrainingOffline which would clear the
    // tombstone — that path is reserved for explicit user-facing saves).
    const { openDB } = await import('idb');
    const db = await openDB('rope-works-inspections');
    if (db.objectStoreNames.contains('trainings')) {
      await db.put('trainings' as never, {
        id: 'trn-drop-1',
        inspector_id: 'u1',
        organization: 'Acme',
        dirty: true,
      } as never);
    }
    db.close();

    rows = await getUnsyncedTrainings('u1');
    expect((rows as Array<{ id: string }>).map(r => r.id)).not.toContain('trn-drop-1');
  });

  it('ledger fallback respects tombstones (listUnsyncedSnapshots skips dropped ids)', async () => {
    const { addTombstone } = await import('../local-record-tombstones');
    addTombstone('trainings', 'trn-led-1');
    // Seed a synced:false ledger entry for the dropped id.
    localStorage.setItem('rw_backup_training_trn-led-1', JSON.stringify({
      v: 1, ts: Date.now(), synced: false, parent: { inspector_id: 'u1' }, children: {}, photoMetadata: [],
    }));
    // And one for a still-pending id.
    localStorage.setItem('rw_backup_training_trn-led-keep', JSON.stringify({
      v: 1, ts: Date.now(), synced: false, parent: { inspector_id: 'u1' }, children: {}, photoMetadata: [],
    }));

    const { listUnsyncedDbRowsFromLedger } = await import('../local-backup-ledger');
    const rows = listUnsyncedDbRowsFromLedger('training', 'u1');
    expect(rows.map(r => r.id)).toEqual(['trn-led-keep']);
  });

  it('fresh user-facing save with same id lifts the tombstone (legitimate new work resurfaces)', async () => {
    const {
      saveTrainingOffline,
      getUnsyncedTrainings,
      forceDeleteLocalRecord,
    } = await import('../offline-storage');
    await saveTrainingOffline({ id: 'trn-resurrect', inspector_id: 'u1', organization: 'A' });
    await forceDeleteLocalRecord('trainings', 'trn-resurrect');
    let rows = await getUnsyncedTrainings('u1');
    expect((rows as Array<{ id: string }>).map(r => r.id)).not.toContain('trn-resurrect');

    // User creates new work under the same id → tombstone cleared.
    await saveTrainingOffline({ id: 'trn-resurrect', inspector_id: 'u1', organization: 'A-new' });
    rows = await getUnsyncedTrainings('u1');
    expect((rows as Array<{ id: string }>).map(r => r.id)).toContain('trn-resurrect');
  });
});
