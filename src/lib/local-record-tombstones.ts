/**
 * Local Record Tombstones
 *
 * Durable suppression for records the user explicitly dropped from the
 * Sync Terminal via the DROP button (or via `forceDeleteLocalRecord`).
 *
 * Problem this solves
 * -------------------
 * `forceDeleteLocalRecord` removes the row from IndexedDB and scrubs the
 * `rw_backup_*_<id>` localStorage snapshot. However, the row can still
 * resurface from:
 *   - A delayed Realtime/refetch that writes the same id back into IDB
 *     with `dirty=true` or no `synced_at`.
 *   - A localStorage backup snapshot under an unexpected alias the purge
 *     missed.
 *   - The wedge-ledger fallback (`listUnsyncedDbRowsFromLedger`) reading
 *     a stale `synced:false` snapshot during an IDB wedge.
 *
 * Tombstones are an ID-based, source-agnostic veto: any unsynced reader
 * that consults `isTombstoned(table, id)` will silently drop that row.
 *
 * Self-healing
 * ------------
 * Tombstones auto-expire after 60 days (matches existing soft-delete
 * retention) and are cleared the moment a fresh user-facing save lands
 * for the same record id — so DROP cannot accidentally hide legitimate
 * new work the user created later under the same id.
 */

export type TombstonedTable = 'inspections' | 'trainings' | 'daily_assessments';

const STORAGE_KEY = 'rw_local_record_tombstones_v1';
const TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

type TombstoneMap = Partial<Record<TombstonedTable, Record<string, number>>>;

function readMap(): TombstoneMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as TombstoneMap;
  } catch {
    return {};
  }
}

function writeMap(map: TombstoneMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / unavailable — tombstone is best-effort */
  }
}

function pruneExpired(map: TombstoneMap): TombstoneMap {
  const cutoff = Date.now() - TTL_MS;
  let changed = false;
  for (const table of Object.keys(map) as TombstonedTable[]) {
    const bucket = map[table];
    if (!bucket) continue;
    for (const id of Object.keys(bucket)) {
      if (bucket[id] < cutoff) {
        delete bucket[id];
        changed = true;
      }
    }
    if (Object.keys(bucket).length === 0) {
      delete map[table];
      changed = true;
    }
  }
  if (changed) writeMap(map);
  return map;
}

export function addTombstone(table: TombstonedTable, id: string): void {
  if (!id) return;
  const map = readMap();
  const bucket = map[table] ?? {};
  bucket[id] = Date.now();
  map[table] = bucket;
  writeMap(map);
}

export function isTombstoned(table: TombstonedTable, id: string | undefined | null): boolean {
  if (!id) return false;
  const map = pruneExpired(readMap());
  const ts = map[table]?.[id];
  if (!ts) return false;
  if (ts < Date.now() - TTL_MS) return false;
  return true;
}

export function clearTombstone(table: TombstonedTable, id: string | undefined | null): void {
  if (!id) return;
  const map = readMap();
  const bucket = map[table];
  if (!bucket || !(id in bucket)) return;
  delete bucket[id];
  if (Object.keys(bucket).length === 0) delete map[table];
  writeMap(map);
}

export function listTombstones(table: TombstonedTable): string[] {
  const map = pruneExpired(readMap());
  return Object.keys(map[table] ?? {});
}

// Mapping helper: the local-backup-ledger uses the singular ReportType
// ('inspection' | 'training' | 'daily_assessment'). Translate to the plural
// IDB store name used as the tombstone bucket key.
export function tableForReportType(
  reportType: 'inspection' | 'training' | 'daily_assessment',
): TombstonedTable {
  switch (reportType) {
    case 'inspection': return 'inspections';
    case 'training': return 'trainings';
    case 'daily_assessment': return 'daily_assessments';
  }
}

// Test-only reset
export function __test_only__clearAllTombstones(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}
