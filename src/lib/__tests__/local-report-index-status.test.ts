/**
 * Tests for listLocalTrainingsWithStatus — the status-bearing variant used
 * by Recovery & Sync Health to render safe loading / error / partial /
 * empty states without ever leaving the user on an indefinite spinner.
 *
 * Guarantees verified here:
 *  - Empty IDB + no backups → entries=[], idbUnavailable=false.
 *  - Healthy IDB returns scoped entries.
 *  - One malformed row is skipped, partial=true, the rest are returned.
 *  - getDB() that hangs longer than the 3 s budget → idbUnavailable=true;
 *    backup-envelope discovery still runs.
 *  - getDB() that rejects → idbUnavailable=true; backup entries still surface.
 *  - Owner scoping still applies.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/offline-storage', () => ({
  getDB: vi.fn(),
}));

import { getDB } from '@/lib/offline-storage';
import { listLocalTrainingsWithStatus } from '@/lib/recovery/local-report-index';

function fakeDb(
  rows: Array<Record<string, unknown>>,
  opts: { getAllThrows?: boolean; hasStore?: boolean } = {},
) {
  return {
    objectStoreNames: {
      contains: (n: string) => (opts.hasStore === false ? false : n === 'trainings'),
    } as unknown as DOMStringList,
    getAll: async (_: string) => {
      if (opts.getAllThrows) throw new Error('getAll boom');
      return rows;
    },
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
  vi.useRealTimers();
});

describe('listLocalTrainingsWithStatus', () => {
  it('returns empty result for a regular user with zero local trainings', async () => {
    vi.mocked(getDB).mockResolvedValue(fakeDb([]));
    const r = await listLocalTrainingsWithStatus('u1');
    expect(r).toEqual({ entries: [], idbUnavailable: false, partial: false });
  });

  it('returns scoped entries for a regular user with mixed-owner trainings', async () => {
    vi.mocked(getDB).mockResolvedValue(
      fakeDb([
        { id: 'a', inspector_id: 'u1', organization: 'Mine', updated_at: '2026-05-01' },
        { id: 'b', inspector_id: 'u2', organization: 'Theirs', updated_at: '2026-05-02' },
      ]),
    );
    const r = await listLocalTrainingsWithStatus('u1');
    expect(r.idbUnavailable).toBe(false);
    expect(r.partial).toBe(false);
    expect(r.entries.map((e) => e.id)).toEqual(['a']);
  });

  it('skips one malformed row, sets partial=true, returns the rest', async () => {
    // Make one row poison `ownerOf` via a property getter that throws.
    const bad: Record<string, unknown> = { id: 'bad' };
    Object.defineProperty(bad, 'inspector_id', {
      get() {
        throw new Error('row boom');
      },
      enumerable: true,
    });
    vi.mocked(getDB).mockResolvedValue(
      fakeDb([
        { id: 'a', inspector_id: 'u1', organization: 'A' },
        bad,
        { id: 'c', inspector_id: 'u1', organization: 'C' },
      ]),
    );
    const r = await listLocalTrainingsWithStatus('u1');
    expect(r.idbUnavailable).toBe(false);
    expect(r.partial).toBe(true);
    expect(r.entries.map((e) => e.id).sort()).toEqual(['a', 'c']);
  });

  it('flags idbUnavailable=true when getDB() hangs past the 3s budget, and still surfaces backup entries', async () => {
    vi.useFakeTimers();
    // never-resolving getDB
    vi.mocked(getDB).mockReturnValue(new Promise(() => {}) as ReturnType<typeof getDB>);
    setLocalStorageEntries({
      rw_backup_x: JSON.stringify({
        timestamp: 1,
        data: { id: 'from-backup', organization: 'Backup Camp', inspector_id: 'u1' },
      }),
    });

    const p = listLocalTrainingsWithStatus('u1');
    // Advance past the 3s IDB budget.
    await vi.advanceTimersByTimeAsync(3500);
    const r = await p;

    expect(r.idbUnavailable).toBe(true);
    expect(r.entries.map((e) => e.id)).toEqual(['from-backup']);
  });

  it('flags idbUnavailable=true when getDB() rejects, and backups still surface', async () => {
    vi.mocked(getDB).mockRejectedValue(new Error('idb closed'));
    setLocalStorageEntries({
      rw_backup_b: JSON.stringify({
        timestamp: 1,
        data: { id: 'b', organization: 'Backup B', inspector_id: 'u1' },
      }),
    });
    const r = await listLocalTrainingsWithStatus('u1');
    expect(r.idbUnavailable).toBe(true);
    expect(r.entries.map((e) => e.id)).toEqual(['b']);
  });

  it('flags idbUnavailable=true when getAll() throws after open succeeds', async () => {
    vi.mocked(getDB).mockResolvedValue(fakeDb([], { getAllThrows: true }));
    const r = await listLocalTrainingsWithStatus('u1');
    expect(r.idbUnavailable).toBe(true);
    expect(r.entries).toEqual([]);
    expect(r.partial).toBe(false);
  });

  it('does not treat a missing trainings store as idbUnavailable', async () => {
    vi.mocked(getDB).mockResolvedValue(fakeDb([], { hasStore: false }));
    const r = await listLocalTrainingsWithStatus('u1');
    expect(r.idbUnavailable).toBe(false);
    expect(r.entries).toEqual([]);
  });
});
