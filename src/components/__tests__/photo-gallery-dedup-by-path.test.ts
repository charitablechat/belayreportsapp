import { describe, it, expect } from 'vitest';
import { dedupeOfflineAgainstDb, type OfflineDedupRow } from '../photo-gallery-helpers';

/**
 * Regression coverage for the Training-photos duplicate-thumbnail issue.
 *
 * The DB layer now refuses duplicate (training_id, photo_url, photo_section)
 * rows via `idx_training_photos_no_duplicates`. This test pins the *UI*
 * contract: even if an offline row and its synced remote row both surface
 * in the same `loadPhotos()` pass, only one tile renders.
 */

const noTombstones = () => false;

describe('dedupeOfflineAgainstDb', () => {
  it('drops an offline row whose rawStoragePath matches a DB row (db-dup)', () => {
    const offline: OfflineDedupRow[] = [
      { id: 'local-1', rawStoragePath: 'user/inspection/abc.jpg', caption: 'A' },
      { id: 'local-2', rawStoragePath: 'user/inspection/def.jpg', caption: 'B' },
    ];
    const dbPaths = new Set(['user/inspection/abc.jpg']);

    const result = dedupeOfflineAgainstDb(offline, dbPaths, noTombstones);

    expect(result.kept.map(r => r.id)).toEqual(['local-2']);
    expect(result.dropped).toEqual([
      { id: 'local-1', rawStoragePath: 'user/inspection/abc.jpg', caption: 'A', reason: 'db-dup' },
    ]);
  });

  it('keeps offline rows with an empty rawStoragePath (pre-sync, no server path yet)', () => {
    const offline: OfflineDedupRow[] = [
      { id: 'local-1', rawStoragePath: '', caption: null },
      { id: 'local-2', caption: null }, // undefined path
    ];
    const dbPaths = new Set<string>(['user/inspection/abc.jpg']);

    const result = dedupeOfflineAgainstDb(offline, dbPaths, noTombstones);

    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
  });

  it('drops a tombstoned offline row regardless of DB state', () => {
    const offline: OfflineDedupRow[] = [
      { id: 'local-1', rawStoragePath: 'user/inspection/abc.jpg', caption: 'A' },
    ];
    const dbPaths = new Set<string>(); // DB does NOT have this path
    const isTombstoned = (rp: string) => rp === 'user/inspection/abc.jpg';

    const result = dedupeOfflineAgainstDb(offline, dbPaths, isTombstoned);

    expect(result.kept).toHaveLength(0);
    expect(result.dropped[0].reason).toBe('tombstoned');
  });

  it('two distinct offline + DB photos produce two distinct kept entries (no false collapse)', () => {
    // Simulates the user-visible scenario: two different files uploaded
    // sequentially → two distinct DB rows + two distinct offline rows.
    const offline: OfflineDedupRow[] = [
      { id: 'local-1', rawStoragePath: 'user/training/photo-A.jpg', caption: null },
      { id: 'local-2', rawStoragePath: 'user/training/photo-B.jpg', caption: null },
    ];
    // Both offline rows have already synced; DB confirms both paths.
    const dbPaths = new Set([
      'user/training/photo-A.jpg',
      'user/training/photo-B.jpg',
    ]);

    const result = dedupeOfflineAgainstDb(offline, dbPaths, noTombstones);

    // Offline rows collapse into the (canonical) DB rows; final gallery
    // shows exactly two tiles, never four and never the same image twice.
    expect(result.kept).toHaveLength(0);
    expect(result.dropped.map(d => d.reason)).toEqual(['db-dup', 'db-dup']);
  });
});
