/**
 * Slice 5C — Admin server-snapshot shape validator.
 *
 * Pure module: no React, no IDB, no Supabase, no toast, no logging.
 *
 * Admin server snapshots ("All User Snapshots" via `restoreSnapshotToServer`
 * and "Admin Edit History" via `restoreAdminEditSnapshot`) store children
 * keyed by the real Supabase table name (e.g. `inspection_equipment`),
 * NOT by the local-IDB key shorthand (`equipment`) used in
 * `src/lib/recovery/restore-shape.ts`. This whitelist mirrors
 * `CHILD_TABLES` in `src/lib/admin-edit-snapshot.ts` so any unknown table
 * key in a snapshot blocks the restore.
 *
 * Policy:
 *   - parent must be a non-null plain object
 *   - parent.id must be a non-empty string
 *   - children must be a plain object (not array, not null)
 *   - every child key must be in the per-type table whitelist
 *     (unknown key → fail closed)
 *   - every child value must be an array
 *   - parent.updated_at is NOT required; freshness comparison handles
 *     missing/unparseable values by returning 'unknown'
 */

export type AdminRestoreReportType =
  | 'inspection'
  | 'training'
  | 'daily_assessment';

const ALLOWED_ADMIN_CHILD_KEYS: Record<AdminRestoreReportType, ReadonlySet<string>> = {
  inspection: new Set([
    'inspection_systems',
    'inspection_ziplines',
    'inspection_equipment',
    'inspection_standards',
    'inspection_summary',
    'inspection_photos',
  ]),
  training: new Set([
    'training_delivery_approaches',
    'training_operating_systems',
    'training_immediate_attention',
    'training_verifiable_items',
    'training_systems_in_place',
    'training_summary',
    'training_photos',
  ]),
  daily_assessment: new Set([
    'daily_assessment_beginning_of_day',
    'daily_assessment_end_of_day',
    'daily_assessment_operating_systems',
    'daily_assessment_equipment_checks',
    'daily_assessment_structure_checks',
    'daily_assessment_environment_checks',
    'daily_assessment_photos',
  ]),
};

export type AdminRestoreShapeFailureReason =
  | 'parent_missing'
  | 'parent_id_missing'
  | 'children_not_object'
  | 'child_key_unknown'
  | 'child_not_array';

export interface AdminRestoreShapeInput {
  expectedReportType: AdminRestoreReportType;
  snapshotData:
    | {
        parent?: unknown;
        children?: unknown;
      }
    | null
    | undefined;
}

export type AdminRestoreShapeResult =
  | {
      ok: true;
      parent: Record<string, unknown> & { id: string };
      children: Record<string, unknown[]>;
    }
  | {
      ok: false;
      reason: AdminRestoreShapeFailureReason;
      /** Sanitized indicator for tests / internal observability. Never user-facing. */
      field?: string;
    };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.prototype.toString.call(v) === '[object Object]'
  );
}

export function validateAdminSnapshotShape(
  input: AdminRestoreShapeInput,
): AdminRestoreShapeResult {
  const { expectedReportType, snapshotData } = input;
  if (!snapshotData || typeof snapshotData !== 'object') {
    return { ok: false, reason: 'parent_missing' };
  }
  const parent = (snapshotData as { parent?: unknown }).parent;
  if (!isPlainObject(parent)) {
    return { ok: false, reason: 'parent_missing' };
  }
  const parentId = (parent as { id?: unknown }).id;
  if (typeof parentId !== 'string' || parentId.length === 0) {
    return { ok: false, reason: 'parent_id_missing' };
  }

  const childrenRaw = (snapshotData as { children?: unknown }).children;
  if (!isPlainObject(childrenRaw)) {
    return { ok: false, reason: 'children_not_object' };
  }

  const allowed = ALLOWED_ADMIN_CHILD_KEYS[expectedReportType];
  const childrenSafe: Record<string, unknown[]> = {};
  for (const [key, value] of Object.entries(childrenRaw)) {
    if (!allowed.has(key)) {
      return { ok: false, reason: 'child_key_unknown', field: key };
    }
    if (!Array.isArray(value)) {
      return { ok: false, reason: 'child_not_array', field: key };
    }
    childrenSafe[key] = value;
  }

  return {
    ok: true,
    parent: parent as Record<string, unknown> & { id: string },
    children: childrenSafe,
  };
}

/** Exported for test introspection only. */
export const _ALLOWED_ADMIN_CHILD_KEYS = ALLOWED_ADMIN_CHILD_KEYS;
