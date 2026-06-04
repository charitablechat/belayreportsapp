/**
 * Slice 5C — Admin server-snapshot envelope / identity validator.
 *
 * Pure module: no React, no IDB, no Supabase, no toast, no logging.
 *
 * Validates the outer "this row claims to be a snapshot for report X of
 * type Y" envelope on an admin server snapshot row (either a
 * `report_cloud_backups` row used by the All User Snapshots restore, or
 * an `admin_edit_snapshots` row used by the Admin Edit History restore)
 * BEFORE any mutation. Unlike the local/cloud → IDB envelope validator
 * (`src/lib/recovery/restore-envelope.ts`), the expected `(reportType,
 * reportId)` pair is derived FROM the row itself — there is no separate
 * caller-supplied "I clicked Restore on report X" pair to cross-check
 * against. Identity is therefore enforced two ways:
 *
 *   1. row.report_type ∈ {inspection,training,daily_assessment}
 *   2. row.report_id is a non-empty string
 *   3. snapshot_data.parent.id (when present) === row.report_id
 *   4. snapshot_data.parent.report_type (when present) === row.report_type
 *
 * Output is a small discriminated union. Callers map `reason` to a
 * user-facing toast and a sanitized log record.
 */

import type { AdminRestoreReportType } from './admin-restore-shape';

const KNOWN_REPORT_TYPES: ReadonlySet<string> = new Set([
  'inspection',
  'training',
  'daily_assessment',
]);

export type AdminRestoreEnvelopeFailureReason =
  | 'envelope_missing'
  | 'envelope_type_unknown'
  | 'envelope_id_missing'
  | 'parent_id_mismatch'
  | 'parent_type_mismatch';

export interface AdminRestoreEnvelopeInput {
  /**
   * The raw snapshot row. `report_type` and `report_id` are read from the
   * server-stored row (immutable in practice; re-validated inside the
   * restore lock to close TOCTOU regardless).
   */
  row: {
    report_type?: unknown;
    report_id?: unknown;
    snapshot_data?: unknown;
  } | null | undefined;
}

export type AdminRestoreEnvelopeResult =
  | {
      ok: true;
      reportType: AdminRestoreReportType;
      reportId: string;
    }
  | {
      ok: false;
      reason: AdminRestoreEnvelopeFailureReason;
    };

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function validateAdminRestoreEnvelope(
  input: AdminRestoreEnvelopeInput,
): AdminRestoreEnvelopeResult {
  const row = input.row;
  if (!row || typeof row !== 'object') {
    return { ok: false, reason: 'envelope_missing' };
  }
  const reportType = asString((row as { report_type?: unknown }).report_type);
  const reportId = asString((row as { report_id?: unknown }).report_id);
  if (!reportType) {
    return { ok: false, reason: 'envelope_missing' };
  }
  if (!KNOWN_REPORT_TYPES.has(reportType)) {
    return { ok: false, reason: 'envelope_type_unknown' };
  }
  if (!reportId) {
    return { ok: false, reason: 'envelope_id_missing' };
  }

  // Cross-check inner parent identity when present. Shape validator owns
  // the "parent missing" path, so we don't fail here on missing parent.
  const sd = (row as { snapshot_data?: unknown }).snapshot_data;
  if (sd && typeof sd === 'object') {
    const parent = (sd as { parent?: unknown }).parent;
    if (parent && typeof parent === 'object') {
      const parentId = asString((parent as { id?: unknown }).id);
      if (parentId && parentId !== reportId) {
        return { ok: false, reason: 'parent_id_mismatch' };
      }
      const parentType = asString((parent as { report_type?: unknown }).report_type);
      if (parentType && parentType !== reportType) {
        return { ok: false, reason: 'parent_type_mismatch' };
      }
    }
  }

  return {
    ok: true,
    reportType: reportType as AdminRestoreReportType,
    reportId,
  };
}
