/**
 * Tests for listLocalTrainings — read-only local index used by /recovery.
 *
 * Verifies: per-user filtering on shared devices, offline behavior (no server),
 * skipping of soft-deleted rows, and localOnly labeling.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => {
  vi.mocked(getDB).mockReset();
});

describe('listLocalTrainings', () => {
  it('returns [] when the trainings store is missing', async () => {
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
});
