import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `evictSyncedBackupSnapshots(bytesNeeded)` — reactive eviction invoked from
 * `emergencyLocalStorageFallback` when `localStorage.setItem` throws
 * `QuotaExceededError` (Sentry: `2c20f8bfe85e4783a70973e4102c2746`, Safari 26.4).
 *
 * Pinning the contract:
 *   1. Returns 0 when there are no `rw_backup_*` keys at all.
 *   2. Never evicts unsynced snapshots — those are the in-progress work
 *      we're trying to preserve.
 *   3. Evicts oldest-synced first (sorted by `ts` ascending).
 *   4. Stops as soon as `freed >= bytesNeeded` — does not gratuitously
 *      delete extra synced snapshots.
 *   5. Ignores non-`rw_backup_*` localStorage keys (don't trash adjacent
 *      keys belonging to other subsystems).
 *   6. Treats corrupt JSON as evictable (its content is unreadable so the
 *      snapshot was already lost).
 *   7. Returns 0 when only unsynced snapshots exist (caller will throw
 *      `QuotaExceededError` to upper layers — no false hope of retry).
 *
 * `localStorage` is mocked via an in-memory shim, identical pattern to
 * `ledger-unsynced-read.test.ts`.
 */

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
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function writeSnapshot(
  key: string,
  data: { synced: boolean; ts: number; payload?: string },
): void {
  localStorage.setItem(
    key,
    JSON.stringify({
      v: 1,
      ts: data.ts,
      synced: data.synced,
      device: 'test-device',
      parent: { id: key.replace('rw_backup_', ''), payload: data.payload ?? 'x' },
      children: {},
    }),
  );
}

describe('evictSyncedBackupSnapshots', () => {
  it('returns 0 when localStorage has no rw_backup_* keys', async () => {
    const { evictSyncedBackupSnapshots } = await import('../offline-storage');
    expect(evictSyncedBackupSnapshots(1024)).toBe(0);
  });

  it('returns 0 when bytesNeeded is <= 0 (defensive guard)', async () => {
    const { evictSyncedBackupSnapshots } = await import('../offline-storage');
    writeSnapshot('rw_backup_inspection_a', { synced: true, ts: 1000 });
    expect(evictSyncedBackupSnapshots(0)).toBe(0);
    expect(evictSyncedBackupSnapshots(-1)).toBe(0);
    // Snapshot still present
    expect(localStorage.getItem('rw_backup_inspection_a')).not.toBeNull();
  });

  it('never evicts unsynced snapshots — the user\'s work is sacred', async () => {
    const { evictSyncedBackupSnapshots } = await import('../offline-storage');
    writeSnapshot('rw_backup_inspection_unsynced', {
      synced: false, ts: 1000, payload: 'a'.repeat(2048),
    });
    writeSnapshot('rw_backup_training_unsynced', {
      synced: false, ts: 2000, payload: 'b'.repeat(2048),
    });

    expect(evictSyncedBackupSnapshots(10_000)).toBe(0);
    expect(localStorage.getItem('rw_backup_inspection_unsynced')).not.toBeNull();
    expect(localStorage.getItem('rw_backup_training_unsynced')).not.toBeNull();
  });

  it('evicts oldest-synced first (sorted by ts ascending)', async () => {
    const { evictSyncedBackupSnapshots } = await import('../offline-storage');
    writeSnapshot('rw_backup_inspection_newest', { synced: true, ts: 5000 });
    writeSnapshot('rw_backup_inspection_oldest', { synced: true, ts: 1000 });
    writeSnapshot('rw_backup_inspection_middle', { synced: true, ts: 3000 });

    // Free enough to require evicting just one
    const freed = evictSyncedBackupSnapshots(50);
    expect(freed).toBeGreaterThan(0);

    // Oldest should be gone, middle + newest still present
    expect(localStorage.getItem('rw_backup_inspection_oldest')).toBeNull();
    expect(localStorage.getItem('rw_backup_inspection_middle')).not.toBeNull();
    expect(localStorage.getItem('rw_backup_inspection_newest')).not.toBeNull();
  });

  it('stops early once freed >= bytesNeeded (does not over-evict)', async () => {
    const { evictSyncedBackupSnapshots } = await import('../offline-storage');
    // Three large synced snapshots
    writeSnapshot('rw_backup_inspection_a', {
      synced: true, ts: 1000, payload: 'x'.repeat(1024),
    });
    writeSnapshot('rw_backup_inspection_b', {
      synced: true, ts: 2000, payload: 'y'.repeat(1024),
    });
    writeSnapshot('rw_backup_inspection_c', {
      synced: true, ts: 3000, payload: 'z'.repeat(1024),
    });

    // Tiny ask — should evict exactly 1
    const freed = evictSyncedBackupSnapshots(100);
    expect(freed).toBeGreaterThanOrEqual(100);

    // Oldest gone, two newer still present
    expect(localStorage.getItem('rw_backup_inspection_a')).toBeNull();
    expect(localStorage.getItem('rw_backup_inspection_b')).not.toBeNull();
    expect(localStorage.getItem('rw_backup_inspection_c')).not.toBeNull();
  });

  it('ignores non-rw_backup_* keys (does not trash adjacent storage)', async () => {
    const { evictSyncedBackupSnapshots } = await import('../offline-storage');
    localStorage.setItem('some_other_app_key', 'critical-data');
    localStorage.setItem('user_pref_theme', 'dark');
    writeSnapshot('rw_backup_inspection_a', { synced: true, ts: 1000 });

    evictSyncedBackupSnapshots(10_000);

    // Adjacent keys must survive
    expect(localStorage.getItem('some_other_app_key')).toBe('critical-data');
    expect(localStorage.getItem('user_pref_theme')).toBe('dark');
  });

  it('treats corrupt JSON as evictable', async () => {
    const { evictSyncedBackupSnapshots } = await import('../offline-storage');
    localStorage.setItem('rw_backup_inspection_corrupt', '{not valid json');
    writeSnapshot('rw_backup_inspection_ok_unsynced', { synced: false, ts: 2000 });

    evictSyncedBackupSnapshots(50);

    // Corrupt was evicted; unsynced ok was not
    expect(localStorage.getItem('rw_backup_inspection_corrupt')).toBeNull();
    expect(localStorage.getItem('rw_backup_inspection_ok_unsynced')).not.toBeNull();
  });

  it('returns 0 when ledger contains only unsynced snapshots (caller will throw)', async () => {
    const { evictSyncedBackupSnapshots } = await import('../offline-storage');
    writeSnapshot('rw_backup_inspection_a', { synced: false, ts: 1000 });
    writeSnapshot('rw_backup_training_b', { synced: false, ts: 2000 });
    writeSnapshot('rw_backup_daily_assessment_c', { synced: false, ts: 3000 });

    const freed = evictSyncedBackupSnapshots(10_000);
    expect(freed).toBe(0);

    // All three still present
    expect(localStorage.getItem('rw_backup_inspection_a')).not.toBeNull();
    expect(localStorage.getItem('rw_backup_training_b')).not.toBeNull();
    expect(localStorage.getItem('rw_backup_daily_assessment_c')).not.toBeNull();
  });

  it('handles all three reportType prefixes equally', async () => {
    const { evictSyncedBackupSnapshots } = await import('../offline-storage');
    writeSnapshot('rw_backup_inspection_a', { synced: true, ts: 1000 });
    writeSnapshot('rw_backup_training_b', { synced: true, ts: 2000 });
    writeSnapshot('rw_backup_daily_assessment_c', { synced: true, ts: 3000 });

    evictSyncedBackupSnapshots(10_000_000); // unrealistically large — evict all

    expect(localStorage.getItem('rw_backup_inspection_a')).toBeNull();
    expect(localStorage.getItem('rw_backup_training_b')).toBeNull();
    expect(localStorage.getItem('rw_backup_daily_assessment_c')).toBeNull();
  });
});
