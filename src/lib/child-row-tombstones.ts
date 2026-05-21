/**
 * Child-row tombstones — scoped, persistent suppression of deleted child
 * records (operating systems, ziplines, equipment, training subsections,
 * daily-assessment children) so that an explicit user delete wins over:
 *   - stale server data on the next refetch,
 *   - stale IDB rows on reload,
 *   - JSON import / default-seed paths,
 *   - merge defaults that "ensure ≥1 row".
 *
 * Pattern mirrors the existing `ZIPLINE_DELETE_TOMBSTONE` pattern in
 * `InspectionForm.tsx` (per-report localStorage bucket, 60d TTL) but is
 * reusable across child entity types and supports a stable businessKey
 * for unsynced/temp-id rows whose server id does not exist yet.
 *
 * NOT a replacement for parent-row `local-record-tombstones.ts` — that
 * handles whole-report DROP from the Sync Terminal. Child tombstones are
 * always scoped to a parent reportId and a child entity type.
 *
 * Important invariants:
 *   - Explicit user delete writes a tombstone before mutating UI/IDB.
 *   - Every load path (offline, server, merge, seed) MUST filter rows
 *     through `filterChildRows()` before render.
 *   - "Ensure at least one blank row" logic MUST create a new row with a
 *     new id; it MUST NOT reuse a tombstoned id/businessKey.
 *   - Tombstones self-expire after 60 days to bound localStorage growth.
 *   - This is the same 60d retention used by parent tombstones and the
 *     soft-delete pipeline.
 */

import { safeRemoveItem, safeSetItem } from "./safe-local-storage";

export type ChildEntity =
  | "inspection_operating_system"
  | "inspection_equipment"
  | "inspection_zipline"
  | "training_subsection_row"
  | "daily_assessment_child";

export type ChildDeleteSource =
  | "explicit-user-delete"
  | "guest-delete"
  | "offline-delete"
  | "sync-delete";

export interface ChildRowTombstone {
  /** Server id when known; null for unsynced/temp rows. */
  id: string | null;
  /** Stable business key for unsynced rows (e.g. lowercased name). */
  businessKey: string | null;
  deletedAt: number;
  source: ChildDeleteSource;
}

const KEY_PREFIX = "rw_child_tombstones_v1:";
const TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

interface ChildRowIdentity {
  id?: string | null;
  businessKey?: string | null;
}

function storageKey(entity: ChildEntity, reportId: string): string {
  return `${KEY_PREFIX}${entity}:${reportId}`;
}

function normalizeBusinessKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const trimmed = String(key).trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function readBucket(entity: ChildEntity, reportId: string): ChildRowTombstone[] {
  try {
    const raw = localStorage.getItem(storageKey(entity, reportId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .filter(
        (t): t is ChildRowTombstone =>
          !!t &&
          typeof t === "object" &&
          typeof t.deletedAt === "number" &&
          now - t.deletedAt < TTL_MS &&
          (typeof t.id === "string" || t.id === null) &&
          (typeof t.businessKey === "string" || t.businessKey === null),
      )
      .map((t) => ({
        id: t.id ?? null,
        businessKey: t.businessKey ? normalizeBusinessKey(t.businessKey) : null,
        deletedAt: t.deletedAt,
        source: (t.source as ChildDeleteSource) ?? "explicit-user-delete",
      }));
  } catch {
    return [];
  }
}

function writeBucket(
  entity: ChildEntity,
  reportId: string,
  bucket: ChildRowTombstone[],
): void {
  try {
    if (bucket.length === 0) {
      safeRemoveItem(storageKey(entity, reportId));
      return;
    }
    safeSetItem(
      storageKey(entity, reportId),
      JSON.stringify(bucket),
      { scope: "child-row-tombstones.write" },
    );
  } catch {
    /* best-effort suppression */
  }
}

/**
 * Add a tombstone for a deleted child row. Idempotent — re-adding the
 * same id/businessKey refreshes the timestamp but does not duplicate.
 *
 * Pass at least one of `id` or `businessKey`. For temp/unsynced rows
 * with no server id yet, businessKey alone is acceptable.
 */
export function addChildTombstone(
  entity: ChildEntity,
  reportId: string,
  identity: ChildRowIdentity,
  source: ChildDeleteSource = "explicit-user-delete",
): void {
  if (!reportId) return;
  const id = identity.id ?? null;
  const businessKey = normalizeBusinessKey(identity.businessKey ?? null);
  if (!id && !businessKey) return; // nothing to anchor a tombstone to

  const bucket = readBucket(entity, reportId);
  // Drop any existing entry with the same id or businessKey, then append fresh.
  const filtered = bucket.filter(
    (t) =>
      !(id && t.id === id) &&
      !(businessKey && t.businessKey === businessKey),
  );
  filtered.push({
    id,
    businessKey,
    deletedAt: Date.now(),
    source,
  });
  writeBucket(entity, reportId, filtered);
}

/**
 * True if the supplied identity matches a non-expired tombstone for
 * this entity+report.
 */
export function isChildTombstoned(
  entity: ChildEntity,
  reportId: string,
  identity: ChildRowIdentity,
): boolean {
  if (!reportId) return false;
  const id = identity.id ?? null;
  const businessKey = normalizeBusinessKey(identity.businessKey ?? null);
  if (!id && !businessKey) return false;
  const bucket = readBucket(entity, reportId);
  return bucket.some(
    (t) =>
      (id && t.id === id) ||
      (businessKey && t.businessKey === businessKey),
  );
}

/**
 * Filter an array of child rows, removing any that match a tombstone.
 *
 * `getBusinessKey` is optional: when present, it's invoked per row to
 * derive a stable key (typically lowercased trimmed name). The same
 * derivation must be used at delete time via `addChildTombstone`.
 */
export function filterChildRows<T extends { id?: string | null }>(
  entity: ChildEntity,
  reportId: string,
  rows: T[],
  getBusinessKey?: (row: T) => string | null | undefined,
): T[] {
  if (!reportId || rows.length === 0) return rows;
  const bucket = readBucket(entity, reportId);
  if (bucket.length === 0) return rows;
  const tombstonedIds = new Set(
    bucket.map((t) => t.id).filter((v): v is string => !!v),
  );
  const tombstonedKeys = new Set(
    bucket.map((t) => t.businessKey).filter((v): v is string => !!v),
  );
  return rows.filter((row) => {
    const rid = row.id ?? null;
    if (rid && tombstonedIds.has(rid)) return false;
    if (getBusinessKey) {
      const bk = normalizeBusinessKey(getBusinessKey(row));
      if (bk && tombstonedKeys.has(bk)) return false;
    }
    return true;
  });
}

/** List active tombstones for tests/diagnostics. */
export function listChildTombstones(
  entity: ChildEntity,
  reportId: string,
): ChildRowTombstone[] {
  return readBucket(entity, reportId);
}

/** Clear a single tombstone (e.g. after the user re-creates the row). */
export function clearChildTombstone(
  entity: ChildEntity,
  reportId: string,
  identity: ChildRowIdentity,
): void {
  if (!reportId) return;
  const id = identity.id ?? null;
  const businessKey = normalizeBusinessKey(identity.businessKey ?? null);
  if (!id && !businessKey) return;
  const bucket = readBucket(entity, reportId);
  const next = bucket.filter(
    (t) =>
      !(id && t.id === id) &&
      !(businessKey && t.businessKey === businessKey),
  );
  if (next.length !== bucket.length) {
    writeBucket(entity, reportId, next);
  }
}

/** Test-only: clear all tombstones across all entities/reports. */
export function __test_only__clearAllChildTombstones(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => safeRemoveItem(k));
  } catch {
    /* noop */
  }
}
