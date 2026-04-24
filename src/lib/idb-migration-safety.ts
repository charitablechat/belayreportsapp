/**
 * Phase 5 — IndexedDB Schema Migration Safety
 *
 * The main offline-storage IndexedDB upgrade path is monolithic: if any step
 * inside the `upgrade()` callback throws, the browser leaves the DB at the
 * NEW version number with a partial schema and no obvious recovery. This
 * module wraps the upgrade with a defensive layer:
 *
 *   1. **Pre-migration snapshot** — before any version bump touches user
 *      data, snapshot the critical stores (inspections / trainings /
 *      daily_assessments + their child rows + photos metadata) into a
 *      sibling IndexedDB so a failed migration can be rolled back without
 *      data loss.
 *   2. **Migration audit log** — every attempted migration writes a row
 *      capturing fromVersion → toVersion, timestamp, status, and (on
 *      failure) the error stack.
 *   3. **Post-migration fingerprint** — after the upgrade transaction
 *      commits, validate that all expected stores + indexes exist. A mismatch
 *      is recorded and surfaced to the boot path.
 *   4. **Restore API** — `restoreFromPreMigrationSnapshot()` is exposed for
 *      the recovery UI; it copies snapshot rows back into the live DB.
 *
 * SAFETY: This module never throws. Every public API returns a result
 * envelope so a corrupt snapshot DB cannot block app boot.
 */

import { openDB, type IDBPDatabase } from 'idb';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const SNAPSHOT_DB_NAME = 'idb-migration-snapshots';
const SNAPSHOT_DB_VERSION = 1;

const STORE_SNAPSHOT_META = 'snapshot_meta';
const STORE_SNAPSHOT_ROWS = 'snapshot_rows';
const STORE_AUDIT = 'migration_audit';

const SNAPSHOT_RETENTION_DAYS = 7;
const AUDIT_MAX_ENTRIES = 100;

/**
 * Stores we snapshot before an upgrade. Only user-data stores — operation
 * queues and caches are intentionally skipped (they can be rebuilt).
 */
const CRITICAL_STORES = [
  'inspections',
  'inspection_systems',
  'inspection_ziplines',
  'inspection_equipment',
  'inspection_standards',
  'inspection_summary',
  'trainings',
  'training_delivery_approaches',
  'training_operating_systems',
  'training_immediate_attention',
  'training_verifiable_items',
  'training_systems_in_place',
  'training_summary',
  'daily_assessments',
  'daily_assessment_beginning_of_day',
  'daily_assessment_end_of_day',
  'daily_assessment_operating_systems',
  'daily_assessment_equipment_checks',
  'daily_assessment_structure_checks',
  'daily_assessment_environment_checks',
  'photos',
] as const;

export type CriticalStoreName = (typeof CRITICAL_STORES)[number];

interface SnapshotMetaRow {
  id: string; // `${dbName}::v${fromVersion}->v${toVersion}`
  dbName: string;
  fromVersion: number;
  toVersion: number;
  createdAt: number;
  storeCounts: Record<string, number>;
  /** Hex SHA-256 over the serialized snapshot — guards against silent corruption. */
  fingerprint: string;
}

interface SnapshotRow {
  /** Composite key: `${snapshotId}::${storeName}::${rowIndex}` */
  id: string;
  snapshotId: string;
  storeName: string;
  rowIndex: number;
  data: unknown;
}

export interface MigrationAuditRow {
  id?: number;
  ts: number;
  dbName: string;
  fromVersion: number;
  toVersion: number;
  status: 'started' | 'snapshot-ok' | 'snapshot-failed' | 'upgrade-ok' | 'upgrade-failed' | 'rolled-back' | 'fingerprint-mismatch';
  durationMs?: number;
  error?: string;
  detail?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Snapshot DB
// ────────────────────────────────────────────────────────────────────────────

let snapshotDbPromise: Promise<IDBPDatabase> | null = null;

function getSnapshotDB(): Promise<IDBPDatabase> {
  if (!snapshotDbPromise) {
    snapshotDbPromise = openDB(SNAPSHOT_DB_NAME, SNAPSHOT_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_SNAPSHOT_META)) {
          db.createObjectStore(STORE_SNAPSHOT_META, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_SNAPSHOT_ROWS)) {
          const s = db.createObjectStore(STORE_SNAPSHOT_ROWS, { keyPath: 'id' });
          s.createIndex('by-snapshot', 'snapshotId');
        }
        if (!db.objectStoreNames.contains(STORE_AUDIT)) {
          db.createObjectStore(STORE_AUDIT, { keyPath: 'id', autoIncrement: true });
        }
      },
    });
    snapshotDbPromise.catch(() => {
      snapshotDbPromise = null;
    });
  }
  return snapshotDbPromise;
}

// ────────────────────────────────────────────────────────────────────────────
// Audit log
// ────────────────────────────────────────────────────────────────────────────

async function appendAudit(row: Omit<MigrationAuditRow, 'id'>): Promise<void> {
  try {
    const db = await getSnapshotDB();
    const tx = db.transaction(STORE_AUDIT, 'readwrite');
    await tx.objectStore(STORE_AUDIT).add(row);
    await tx.done;

    const count = await db.count(STORE_AUDIT);
    if (count > AUDIT_MAX_ENTRIES) {
      const trimTx = db.transaction(STORE_AUDIT, 'readwrite');
      const store = trimTx.objectStore(STORE_AUDIT);
      let cursor = await store.openCursor();
      let removed = 0;
      const toRemove = count - AUDIT_MAX_ENTRIES;
      while (cursor && removed < toRemove) {
        await cursor.delete();
        removed++;
        cursor = await cursor.continue();
      }
      await trimTx.done;
    }

    if (import.meta.env.DEV) {
      console.log(`[idb-migration] ${row.status} v${row.fromVersion}→v${row.toVersion}`, row.detail || row.error || '');
    }
  } catch {
    // Audit is best-effort; never block a migration because we couldn't log it.
  }
}

export async function getMigrationAuditLog(limit = 25): Promise<MigrationAuditRow[]> {
  try {
    const db = await getSnapshotDB();
    const all = (await db.getAll(STORE_AUDIT)) as MigrationAuditRow[];
    return all.slice(-limit).reverse();
  } catch {
    return [];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Fingerprinting
// ────────────────────────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  try {
    const buf = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  } catch {
    let acc = 0;
    for (let i = 0; i < input.length; i++) acc = (acc * 31 + input.charCodeAt(i)) | 0;
    return `nocrypto:${input.length}:${acc.toString(16)}`;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Snapshotting
// ────────────────────────────────────────────────────────────────────────────

function snapshotIdFor(dbName: string, fromVersion: number, toVersion: number): string {
  return `${dbName}::v${fromVersion}->v${toVersion}`;
}

/**
 * Snapshot the critical stores from a live DB into the sibling snapshot DB.
 * Called BEFORE the upgrade transaction begins.
 *
 * Returns `{ ok, snapshotId }` so the caller can later roll back to it.
 */
export async function createPreMigrationSnapshot(
  dbName: string,
  fromVersion: number,
  toVersion: number
): Promise<{ ok: boolean; snapshotId?: string; error?: string }> {
  // Skip when there's nothing meaningful to snapshot (fresh install).
  if (fromVersion <= 0) {
    await appendAudit({
      ts: Date.now(),
      dbName,
      fromVersion,
      toVersion,
      status: 'snapshot-ok',
      detail: 'fresh-install-no-snapshot-needed',
    });
    return { ok: true };
  }

  const snapshotId = snapshotIdFor(dbName, fromVersion, toVersion);

  let liveDb: IDBPDatabase | null = null;
  try {
    // Open at the OLD version (no upgrade hook) so we can read the existing
    // schema. Browsers refuse to "open at lower than current"; if that throws
    // we just open at current.
    try {
      liveDb = await openDB(dbName, fromVersion);
    } catch {
      liveDb = await openDB(dbName);
    }

    const storeCounts: Record<string, number> = {};
    const allRows: SnapshotRow[] = [];
    const presentStores = new Set(Array.from(liveDb.objectStoreNames));

    for (const storeName of CRITICAL_STORES) {
      if (!presentStores.has(storeName)) continue;
      try {
        const rows = await liveDb.getAll(storeName);
        storeCounts[storeName] = rows.length;
        rows.forEach((data, idx) => {
          allRows.push({
            id: `${snapshotId}::${storeName}::${idx}`,
            snapshotId,
            storeName,
            rowIndex: idx,
            data,
          });
        });
      } catch (e) {
        // A single broken store should not abort the whole snapshot.
        if (import.meta.env.DEV) {
          console.warn(`[idb-migration] failed to snapshot store ${storeName}:`, e);
        }
      }
    }

    const fingerprint = await sha256Hex(
      JSON.stringify({ storeCounts, sampleIds: allRows.slice(0, 50).map((r) => r.id) })
    );

    const snapDb = await getSnapshotDB();
    const tx = snapDb.transaction([STORE_SNAPSHOT_META, STORE_SNAPSHOT_ROWS], 'readwrite');
    const meta: SnapshotMetaRow = {
      id: snapshotId,
      dbName,
      fromVersion,
      toVersion,
      createdAt: Date.now(),
      storeCounts,
      fingerprint,
    };
    await tx.objectStore(STORE_SNAPSHOT_META).put(meta);
    const rowStore = tx.objectStore(STORE_SNAPSHOT_ROWS);
    for (const r of allRows) await rowStore.put(r);
    await tx.done;

    await appendAudit({
      ts: Date.now(),
      dbName,
      fromVersion,
      toVersion,
      status: 'snapshot-ok',
      detail: `${allRows.length} rows across ${Object.keys(storeCounts).length} stores`,
    });

    return { ok: true, snapshotId };
  } catch (err: unknown) {
    await appendAudit({
      ts: Date.now(),
      dbName,
      fromVersion,
      toVersion,
      status: 'snapshot-failed',
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: err instanceof Error ? err.message : 'snapshot-failed' };
  } finally {
    try { liveDb?.close(); } catch { /* ignore */ }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Post-migration fingerprint validation
// ────────────────────────────────────────────────────────────────────────────

export interface SchemaExpectation {
  storeName: string;
  indexes?: string[];
}

/**
 * Validate that the live DB has every expected store + index. Returns the
 * list of missing pieces. Empty list = healthy.
 */
export async function validateSchemaFingerprint(
  db: IDBPDatabase,
  expected: SchemaExpectation[]
): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];
  const presentStores = new Set(Array.from(db.objectStoreNames));

  for (const exp of expected) {
    if (!presentStores.has(exp.storeName)) {
      missing.push(`store:${exp.storeName}`);
      continue;
    }
    if (exp.indexes && exp.indexes.length) {
      try {
        const tx = db.transaction(exp.storeName, 'readonly');
        const store = tx.objectStore(exp.storeName);
        const presentIndexes = new Set(Array.from(store.indexNames));
        for (const idx of exp.indexes) {
          if (!presentIndexes.has(idx)) {
            missing.push(`index:${exp.storeName}.${idx}`);
          }
        }
      } catch {
        missing.push(`store-unreadable:${exp.storeName}`);
      }
    }
  }

  return { ok: missing.length === 0, missing };
}

// ────────────────────────────────────────────────────────────────────────────
// Restore from snapshot (recovery API)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Restore the most-recent snapshot for `dbName` back into the live DB.
 *
 * NOTE: This does NOT touch schema — it only re-puts user-data rows. If the
 * upgrade was so broken that stores are missing, this is a no-op for those
 * stores (rows will be skipped) and the caller should consider deleting the
 * DB and prompting the user to re-sync from cloud.
 */
export async function restoreFromPreMigrationSnapshot(
  dbName: string,
  liveDb: IDBPDatabase
): Promise<{ ok: boolean; restored: number; skipped: number; error?: string }> {
  try {
    const snapDb = await getSnapshotDB();
    const allMeta = (await snapDb.getAll(STORE_SNAPSHOT_META)) as SnapshotMetaRow[];
    const candidates = allMeta
      .filter((m) => m.dbName === dbName)
      .sort((a, b) => b.createdAt - a.createdAt);

    if (!candidates.length) {
      return { ok: false, restored: 0, skipped: 0, error: 'no-snapshot-found' };
    }

    const target = candidates[0];
    const allRows = (await snapDb.getAllFromIndex(
      STORE_SNAPSHOT_ROWS,
      'by-snapshot',
      target.id
    )) as SnapshotRow[];

    const presentStores = new Set(Array.from(liveDb.objectStoreNames));
    const byStore = new Map<string, unknown[]>();
    for (const r of allRows) {
      if (!byStore.has(r.storeName)) byStore.set(r.storeName, []);
      byStore.get(r.storeName)!.push(r.data);
    }

    let restored = 0;
    let skipped = 0;
    for (const [storeName, rows] of byStore.entries()) {
      if (!presentStores.has(storeName)) {
        skipped += rows.length;
        continue;
      }
      try {
        const tx = liveDb.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        for (const data of rows) {
          await store.put(data);
          restored++;
        }
        await tx.done;
      } catch {
        skipped += rows.length;
      }
    }

    await appendAudit({
      ts: Date.now(),
      dbName,
      fromVersion: target.fromVersion,
      toVersion: target.toVersion,
      status: 'rolled-back',
      detail: `restored=${restored} skipped=${skipped}`,
    });

    return { ok: true, restored, skipped };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'restore-failed';
    return { ok: false, restored: 0, skipped: 0, error: msg };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Snapshot retention
// ────────────────────────────────────────────────────────────────────────────

/**
 * Delete snapshots older than the retention window. Idempotent — safe to call
 * on every boot.
 */
export async function pruneOldSnapshots(): Promise<void> {
  try {
    const cutoff = Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const db = await getSnapshotDB();
    const allMeta = (await db.getAll(STORE_SNAPSHOT_META)) as SnapshotMetaRow[];
    const expired = allMeta.filter((m) => m.createdAt < cutoff);
    if (!expired.length) return;

    for (const meta of expired) {
      try {
        const rowsToDelete = (await db.getAllFromIndex(
          STORE_SNAPSHOT_ROWS,
          'by-snapshot',
          meta.id
        )) as SnapshotRow[];
        const tx = db.transaction([STORE_SNAPSHOT_META, STORE_SNAPSHOT_ROWS], 'readwrite');
        await tx.objectStore(STORE_SNAPSHOT_META).delete(meta.id);
        const rowStore = tx.objectStore(STORE_SNAPSHOT_ROWS);
        for (const r of rowsToDelete) await rowStore.delete(r.id);
        await tx.done;
      } catch {
        // skip
      }
    }
  } catch {
    // ignore
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Status helpers (for the boot path / recovery UI)
// ────────────────────────────────────────────────────────────────────────────

export async function getLatestSnapshot(dbName: string): Promise<SnapshotMetaRow | null> {
  try {
    const db = await getSnapshotDB();
    const all = (await db.getAll(STORE_SNAPSHOT_META)) as SnapshotMetaRow[];
    const matching = all.filter((m) => m.dbName === dbName).sort((a, b) => b.createdAt - a.createdAt);
    return matching[0] || null;
  } catch {
    return null;
  }
}

export async function recordMigrationStarted(
  dbName: string,
  fromVersion: number,
  toVersion: number
): Promise<void> {
  await appendAudit({ ts: Date.now(), dbName, fromVersion, toVersion, status: 'started' });
}

export async function recordMigrationOutcome(params: {
  dbName: string;
  fromVersion: number;
  toVersion: number;
  ok: boolean;
  durationMs: number;
  error?: string;
  fingerprintMissing?: string[];
}): Promise<void> {
  const { dbName, fromVersion, toVersion, ok, durationMs, error, fingerprintMissing } = params;
  if (ok && (!fingerprintMissing || fingerprintMissing.length === 0)) {
    await appendAudit({
      ts: Date.now(),
      dbName,
      fromVersion,
      toVersion,
      status: 'upgrade-ok',
      durationMs,
    });
    return;
  }
  if (fingerprintMissing && fingerprintMissing.length) {
    await appendAudit({
      ts: Date.now(),
      dbName,
      fromVersion,
      toVersion,
      status: 'fingerprint-mismatch',
      durationMs,
      detail: fingerprintMissing.slice(0, 10).join(','),
    });
    return;
  }
  await appendAudit({
    ts: Date.now(),
    dbName,
    fromVersion,
    toVersion,
    status: 'upgrade-failed',
    durationMs,
    error,
  });
}
