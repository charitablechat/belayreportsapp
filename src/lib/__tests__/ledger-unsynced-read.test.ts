import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Mode 11A — `LocalBackupLedger` filter contract for the alternate read path.
 *
 * `getUnsynced{Inspections,Trainings,DailyAssessments}` in offline-storage.ts
 * fall back to `listUnsyncedDbRowsFromLedger(reportType, userId)` when the
 * Mode 8A layer breaker is open (= confirmed structural wedge). This suite
 * pins the filter contract that the autosync drain depends on:
 *
 *   1. `synced === false` selects only unsynced snapshots.
 *   2. `reportType` filter is exact (no inspection bleeding into training).
 *   3. owner-id filter mirrors IDB: `parent.inspector_id === userId` matches,
 *      `temp-` IDs always recovered as orphans, no userId means "all".
 *   4. `snapshotToDbRow` returns a `DbRow`-shaped object the autosync
 *      pipeline can consume (id present, parent fields preserved).
 *   5. Corrupt JSON entries are skipped (don't break the iteration).
 *   6. Unrelated localStorage keys are ignored (only `rw_backup_*` scanned).
 *
 * `localStorage` is mocked via a fresh in-memory shim per test.
 */

// In-memory localStorage shim — reset per test.
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.get(k) ?? null; }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();
});

function writeSnapshot(
  key: string,
  data: {
    synced: boolean;
    parent: Record<string, unknown>;
    children?: Record<string, unknown>;
    photoMetadata?: unknown[];
  },
): void {
  localStorage.setItem(
    key,
    JSON.stringify({
      v: 1,
      ts: Date.now(),
      synced: data.synced,
      device: 'test-device',
      parent: data.parent,
      children: data.children ?? {},
      photoMetadata: data.photoMetadata ?? [],
    }),
  );
}

describe('Mode 11A — listUnsyncedSnapshots filter contract', () => {
  it('returns [] for an empty ledger', async () => {
    const { listUnsyncedSnapshots } = await import('../local-backup-ledger');
    expect(listUnsyncedSnapshots('inspection')).toEqual([]);
    expect(listUnsyncedSnapshots('training', 'user-1')).toEqual([]);
    expect(listUnsyncedSnapshots('daily_assessment', 'user-1')).toEqual([]);
  });

  it('selects only synced=false entries', async () => {
    const { listUnsyncedSnapshots } = await import('../local-backup-ledger');
    writeSnapshot('rw_backup_inspection_a', {
      synced: false,
      parent: { id: 'a', inspector_id: 'user-1' },
    });
    writeSnapshot('rw_backup_inspection_b', {
      synced: true,
      parent: { id: 'b', inspector_id: 'user-1' },
    });
    const result = listUnsyncedSnapshots('inspection');
    expect(result.map(r => r.reportId).sort()).toEqual(['a']);
  });

  it('exact reportType filter — no inspection→training bleed', async () => {
    const { listUnsyncedSnapshots } = await import('../local-backup-ledger');
    writeSnapshot('rw_backup_inspection_a', {
      synced: false,
      parent: { id: 'a', inspector_id: 'user-1' },
    });
    writeSnapshot('rw_backup_training_b', {
      synced: false,
      parent: { id: 'b', inspector_id: 'user-1' },
    });
    writeSnapshot('rw_backup_daily_assessment_c', {
      synced: false,
      parent: { id: 'c', inspector_id: 'user-1' },
    });
    expect(listUnsyncedSnapshots('inspection').map(r => r.reportId)).toEqual(['a']);
    expect(listUnsyncedSnapshots('training').map(r => r.reportId)).toEqual(['b']);
    expect(listUnsyncedSnapshots('daily_assessment').map(r => r.reportId)).toEqual(['c']);
  });

  it('owner-id filter: matches inspector_id, recovers temp- orphans, drops other owners', async () => {
    const { listUnsyncedSnapshots } = await import('../local-backup-ledger');
    writeSnapshot('rw_backup_inspection_mine', {
      synced: false,
      parent: { id: 'mine', inspector_id: 'user-1' },
    });
    writeSnapshot('rw_backup_inspection_theirs', {
      synced: false,
      parent: { id: 'theirs', inspector_id: 'user-2' },
    });
    writeSnapshot('rw_backup_inspection_temp-orphan', {
      synced: false,
      parent: { id: 'temp-orphan', inspector_id: 'user-2' },
    });
    const result = listUnsyncedSnapshots('inspection', 'user-1');
    expect(result.map(r => r.reportId).sort()).toEqual(['mine', 'temp-orphan']);
  });

  it('omitting userId returns all unsynced (super-admin / cross-user mode)', async () => {
    const { listUnsyncedSnapshots } = await import('../local-backup-ledger');
    writeSnapshot('rw_backup_inspection_a', {
      synced: false,
      parent: { id: 'a', inspector_id: 'user-1' },
    });
    writeSnapshot('rw_backup_inspection_b', {
      synced: false,
      parent: { id: 'b', inspector_id: 'user-2' },
    });
    const result = listUnsyncedSnapshots('inspection');
    expect(result.map(r => r.reportId).sort()).toEqual(['a', 'b']);
  });

  it('skips corrupt JSON entries without throwing', async () => {
    const { listUnsyncedSnapshots } = await import('../local-backup-ledger');
    localStorage.setItem('rw_backup_inspection_corrupt', '{not valid json');
    writeSnapshot('rw_backup_inspection_ok', {
      synced: false,
      parent: { id: 'ok', inspector_id: 'user-1' },
    });
    const result = listUnsyncedSnapshots('inspection', 'user-1');
    expect(result.map(r => r.reportId)).toEqual(['ok']);
  });

  it('ignores unrelated localStorage keys', async () => {
    const { listUnsyncedSnapshots } = await import('../local-backup-ledger');
    localStorage.setItem('unrelated_key', JSON.stringify({ synced: false }));
    localStorage.setItem('app_settings', '{"theme":"dark"}');
    writeSnapshot('rw_backup_inspection_a', {
      synced: false,
      parent: { id: 'a', inspector_id: 'user-1' },
    });
    const result = listUnsyncedSnapshots('inspection', 'user-1');
    expect(result.map(r => r.reportId)).toEqual(['a']);
  });

  it('reportId is recovered from the storage key (not parent.id)', async () => {
    const { listUnsyncedSnapshots } = await import('../local-backup-ledger');
    // Defensive: parent.id absent but storage key carries the id.
    writeSnapshot('rw_backup_inspection_real-id', {
      synced: false,
      parent: { inspector_id: 'user-1' }, // no id field
    });
    const result = listUnsyncedSnapshots('inspection', 'user-1');
    expect(result).toHaveLength(1);
    expect(result[0].reportId).toBe('real-id');
  });
});

describe('Mode 11A — snapshotToDbRow / listUnsyncedDbRowsFromLedger', () => {
  it('snapshotToDbRow returns parent fields with id stamped', async () => {
    const { snapshotToDbRow } = await import('../local-backup-ledger');
    const row = snapshotToDbRow('insp-1', {
      v: 1,
      ts: 1234,
      synced: false,
      device: 'd',
      parent: {
        organization: 'Acme',
        inspector_id: 'user-1',
        synced_at: null,
        updated_at: '2025-01-01T00:00:00Z',
        dirty: true,
      },
      children: {},
    });
    expect(row.id).toBe('insp-1');
    expect(row.organization).toBe('Acme');
    expect(row.inspector_id).toBe('user-1');
    expect(row.dirty).toBe(true);
    expect(row.synced_at).toBe(null);
    expect(row.updated_at).toBe('2025-01-01T00:00:00Z');
  });

  it('snapshotToDbRow id wins over parent.id (key is authoritative)', async () => {
    const { snapshotToDbRow } = await import('../local-backup-ledger');
    const row = snapshotToDbRow('canonical-id', {
      v: 1,
      ts: 1234,
      synced: false,
      device: 'd',
      parent: { id: 'stale-id', inspector_id: 'user-1' },
      children: {},
    });
    expect(row.id).toBe('canonical-id');
  });

  it('listUnsyncedDbRowsFromLedger composes filter + adapter end-to-end', async () => {
    const { listUnsyncedDbRowsFromLedger } = await import('../local-backup-ledger');
    writeSnapshot('rw_backup_inspection_one', {
      synced: false,
      parent: { inspector_id: 'user-1', organization: 'Acme', dirty: true },
    });
    writeSnapshot('rw_backup_inspection_two', {
      synced: false,
      parent: { inspector_id: 'user-2', organization: 'Other' },
    });
    const rows = listUnsyncedDbRowsFromLedger('inspection', 'user-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('one');
    expect(rows[0].organization).toBe('Acme');
    expect(rows[0].dirty).toBe(true);
  });
});
