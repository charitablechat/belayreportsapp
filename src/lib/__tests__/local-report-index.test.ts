/**
 * Tests for listLocalTrainings — read-only local index used by /recovery.
 *
 * Verifies: per-user filtering on shared devices, offline behavior (no server),
 * skipping of soft-deleted rows, localOnly labeling, ordering by updated_at,
 * harvesting of training ids found only in rw_backup_* localStorage envelopes,
 * and tolerance of malformed envelopes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/offline-storage', () => ({
  getDB: vi.fn(),
}));

import { getDB } from '@/lib/offline-storage';
import { listLocalTrainings } from '@/lib/recovery/local-report-index';

function fakeDb(rows: Array<Record<string, unknown>>) {
  return {
    objectStoreNames: { contains: (n: string) => n === 'trainings' } as unknown as DOMStringList,
    getAll: async (_: string) => rows,
  } as unknown as Awaited<ReturnType<typeof getDB>>;
}

function setLocalStorageEntries(entries: Record<string, string>) {
  const store: Record<string, string> = { ...entries };
  const fakeLs = {
    get length() {
      return Object.keys(store).length;
    },
    key(i: number) {
      return Object.keys(store)[i] ?? null;
    },
    getItem(k: string) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem(k: string, v: string) {
      store[k] = v;
    },
    removeItem(k: string) {
      delete store[k];
    },
    clear() {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: fakeLs,
    configurable: true,
  });
}

beforeEach(() => {
  vi.mocked(getDB).mockReset();
  setLocalStorageEntries({});
});

afterEach(() => {
  setLocalStorageEntries({});
});

describe('listLocalTrainings', () => {
  it('returns [] when the trainings store is missing and no backups exist', async () => {
    vi.mocked(getDB).mockResolvedValue({
      objectStoreNames: { contains: () => false } as unknown as DOMStringList,
      getAll: async () => [],
    } as unknown as Awaited<ReturnType<typeof getDB>>);
    expect(await listLocalTrainings('u1')).toEqual([]);
  });

  it('returns rows owned by the signed-in user on a shared device', async () => {
    vi.mocked(getDB).mockResolvedValue(
      fakeDb([
        { id: 'a', inspector_id: 'u1', organization: 'Camp A', updated_at: '2026-05-01' },
        { id: 'b', inspector_id: 'u2', organization: 'Camp B', updated_at: '2026-05-02' },
        { id: 'c', organization: 'Camp C (unowned)', updated_at: '2026-05-03' },
      ]),
    );
    const rows = await listLocalTrainings('u1');
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('a');
    expect(ids).toContain('c'); // unowned legacy row is allowed
    expect(ids).not.toContain('b');
  });

  it('returns multiple owner-owned trainings ordered by updated_at desc', async () => {
    vi.mocked(getDB).mockResolvedValue(
      fakeDb([
        { id: 'a', inspector_id: 'u1', organization: 'A', updated_at: '2026-01-01' },
        { id: 'b', inspector_id: 'u1', organization: 'B', updated_at: '2026-03-01' },
        { id: 'c', inspector_id: 'u1', organization: 'C', updated_at: '2026-02-01' },
      ]),
    );
    const ids = (await listLocalTrainings('u1')).map((r) => r.id);
    expect(ids).toEqual(['b', 'c', 'a']);
  });

  it('marks rows without synced_at as localOnly', async () => {
    vi.mocked(getDB).mockResolvedValue(
      fakeDb([
        { id: 'a', inspector_id: 'u1', synced_at: '2026-05-01', organization: 'Synced' },
        { id: 'b', inspector_id: 'u1', organization: 'Not synced' },
      ]),
    );
    const rows = await listLocalTrainings('u1');
    expect(rows.find((r) => r.id === 'a')?.localOnly).toBe(false);
    expect(rows.find((r) => r.id === 'b')?.localOnly).toBe(true);
  });

  it('skips soft-deleted rows', async () => {
    vi.mocked(getDB).mockResolvedValue(
      fakeDb([
        { id: 'a', inspector_id: 'u1', organization: 'Alive' },
        { id: 'b', inspector_id: 'u1', organization: 'Gone', deleted_at: '2026-05-01' },
        { id: 'c', inspector_id: 'u1', organization: 'Quarantined', _remote_deleted_at: 1 },
      ]),
    );
    const ids = (await listLocalTrainings('u1')).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['a']));
    expect(ids).not.toContain('b');
    expect(ids).not.toContain('c');
  });

  it('does not contact the server (no network errors propagate)', async () => {
    vi.mocked(getDB).mockResolvedValue(fakeDb([]));
    await expect(listLocalTrainings(null)).resolves.toEqual([]);
  });

  it('surfaces a training id found only in an rw_backup_* envelope', async () => {
    vi.mocked(getDB).mockResolvedValue(fakeDb([]));
    setLocalStorageEntries({
      rw_backup_t1: JSON.stringify({
        timestamp: Date.parse('2026-05-04'),
        data: {
          id: 'only-in-backup',
          organization: 'Camp Backup',
          start_date: '2026-05-04',
          inspector_id: 'u1',
        },
      }),
    });
    const rows = await listLocalTrainings('u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('only-in-backup');
    expect(rows[0].fromBackupOnly).toBe(true);
    expect(rows[0].localOnly).toBe(true);
    expect(rows[0].displayName).toBe('Camp Backup');
  });

  it('does not duplicate a training present both in IDB and in a backup envelope', async () => {
    vi.mocked(getDB).mockResolvedValue(
      fakeDb([{ id: 'dup', inspector_id: 'u1', organization: 'Real' }]),
    );
    setLocalStorageEntries({
      rw_backup_dup: JSON.stringify({
        timestamp: 0,
        data: { id: 'dup', organization: 'Backup copy' },
      }),
    });
    const rows = await listLocalTrainings('u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].displayName).toBe('Real');
    expect(rows[0].fromBackupOnly).toBe(false);
  });

  it('does not surface backup entries owned by another user', async () => {
    vi.mocked(getDB).mockResolvedValue(fakeDb([]));
    setLocalStorageEntries({
      rw_backup_x: JSON.stringify({
        timestamp: 0,
        data: { id: 'foreign', inspector_id: 'someone-else', organization: 'Other camp' },
      }),
    });
    const rows = await listLocalTrainings('u1');
    expect(rows).toEqual([]);
  });

  it('tolerates malformed envelopes, missing fields, and bad JSON without throwing', async () => {
    vi.mocked(getDB).mockResolvedValue(fakeDb([]));
    setLocalStorageEntries({
      rw_backup_bad_json: '{not json',
      rw_backup_null: 'null',
      rw_backup_no_id: JSON.stringify({ timestamp: 0, data: { organization: 'No id' } }),
      rw_backup_wrong_types: JSON.stringify({
        timestamp: 'not-a-number',
        data: { id: 123, organization: 456 },
      }),
      rw_backup_ok: JSON.stringify({
        timestamp: 1,
        data: { id: 'ok', organization: 'OK', inspector_id: 'u1' },
      }),
    });
    const rows = await listLocalTrainings('u1');
    expect(rows.map((r) => r.id)).toEqual(['ok']);
  });

  it('tolerates IDB failure and still returns backup entries', async () => {
    vi.mocked(getDB).mockRejectedValue(new Error('idb gone'));
    setLocalStorageEntries({
      rw_backup_b: JSON.stringify({
        timestamp: 0,
        data: { id: 'b', organization: 'Backup B', inspector_id: 'u1' },
      }),
    });
    const rows = await listLocalTrainings('u1');
    expect(rows.map((r) => r.id)).toEqual(['b']);
  });
});
