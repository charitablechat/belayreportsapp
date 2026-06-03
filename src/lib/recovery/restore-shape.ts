/**
 * Slice 5B — Snapshot shape validator.
 *
 * Pure module: no React, no IDB, no Supabase, no toast, no logging.
 *
 * Policy:
 *   - parent must be a non-null object
 *   - parent.id must be a non-empty string
 *   - parent.updated_at is NOT required; freshness comparison handles
 *     missing/unparseable values by returning 'unknown'
 *   - children must be an object (not an array, not null)
 *   - every child key must be in the per-type whitelist
 *     (unknown child key → fail closed)
 *   - every child value, when present, must be an array
 *
 * Per-type whitelists are duplicated here (not imported from
 * offline-storage internal types) to keep this module dependency-free
 * and to allow the validator to remain authoritative on what restore
 * accepts. If offline-storage adds a new legitimate child key, this
 * whitelist must be updated in the same change.
 */

import type { ReportType } from '@/lib/local-backup-ledger';

const ALLOWED_CHILD_KEYS: Record<ReportType, ReadonlySet<string>> = {
  inspection: new Set([
    'systems',
    'ziplines',
    'equipment',
    'standards',
    'summary',
  ]),
  training: new Set([
    'delivery_approaches',
    'operating_systems',
    'immediate_attention',
    'verifiable_items',
    'systems_in_place',
    'summary',
  ]),
  daily_assessment: new Set([
    'beginning_of_day',
    'end_of_day',
    'operating_systems',
    'equipment_checks',
    'structure_checks',
    'environment_checks',
  ]),
};

export type RestoreShapeFailureReason =
  | 'parent_missing'
  | 'parent_id_missing'
  | 'children_not_object'
  | 'child_key_unknown'
  | 'child_not_array';

export interface RestoreShapeInput {
  expectedReportType: ReportType;
  snapshot:
    | {
        parent?: unknown;
        children?: unknown;
      }
    | null
    | undefined;
}

export type RestoreShapeResult =
  | {
      ok: true;
      parent: Record<string, unknown> & { id: string };
      children: Record<string, unknown[]>;
    }
  | {
      ok: false;
      reason: RestoreShapeFailureReason;
      /**
       * Sanitized indicator for tests / internal observability. NEVER
       * forwarded to user-facing toasts. The caller's log path uses the
       * existing Slice 5A sanitizer; this field is for the gate result
       * only.
       */
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

export function validateSnapshotShape(
  input: RestoreShapeInput,
): RestoreShapeResult {
  const { expectedReportType, snapshot } = input;
  if (!snapshot || typeof snapshot !== 'object') {
    return { ok: false, reason: 'parent_missing' };
  }
  const parent = (snapshot as { parent?: unknown }).parent;
  if (!isPlainObject(parent)) {
    return { ok: false, reason: 'parent_missing' };
  }
  const parentId = (parent as { id?: unknown }).id;
  if (typeof parentId !== 'string' || parentId.length === 0) {
    return { ok: false, reason: 'parent_id_missing' };
  }

  const childrenRaw = (snapshot as { children?: unknown }).children;
  if (!isPlainObject(childrenRaw)) {
    return { ok: false, reason: 'children_not_object' };
  }

  const allowed = ALLOWED_CHILD_KEYS[expectedReportType];
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
export const _ALLOWED_CHILD_KEYS = ALLOWED_CHILD_KEYS;
