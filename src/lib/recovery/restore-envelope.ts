/**
 * Slice 5B — Envelope / parent-identity validator.
 *
 * Pure module: no React, no IDB, no Supabase, no toast, no logging.
 *
 * Purpose:
 *   Reject restore inputs whose envelope (the outer "this is a snapshot
 *   for X" wrapper) disagrees with the in-component (reportType, reportId)
 *   pair, OR whose inner parent row identifies a different record, BEFORE
 *   any IDB write occurs.
 *
 * Local-snapshot envelope:  the in-memory `(reportType, reportId)` pair
 *   the user clicked Restore on, vs. the loaded `snapshot.parent`.
 *
 * Cloud-snapshot envelope:  the `full.report_type` / `full.report_id`
 *   fields on the cloud-backup row, vs. the inner `full.snapshot_data.parent`.
 *
 * Output is a small discriminated union; callers map `reason` to a
 * user-facing toast and a sanitized log record.
 */

import type { ReportType } from '@/lib/local-backup-ledger';

export type RestoreEnvelopeFailureReason =
  | 'envelope_missing'
  | 'envelope_type_mismatch'
  | 'envelope_id_mismatch'
  | 'parent_type_mismatch'
  | 'parent_id_mismatch';

export interface RestoreEnvelopeInput {
  expectedReportType: ReportType;
  expectedReportId: string;
  /**
   * Outer envelope. For Local restore this can be `null` (the caller
   * already knows the type/id pair and there is no separate envelope row);
   * the validator then only checks parent identity. For Cloud restore the
   * caller should pass `{ report_type, report_id }` from the cloud-backup
   * row.
   */
  envelope:
    | {
        report_type?: unknown;
        report_id?: unknown;
      }
    | null
    | undefined;
  /**
   * Inner parent row from `snapshot.parent` / `snapshot_data.parent`.
   * Validators below tolerate missing fields and treat them as failure
   * reasons rather than throwing.
   */
  parent: Record<string, unknown> | null | undefined;
}

export type RestoreEnvelopeResult =
  | { ok: true }
  | { ok: false; reason: RestoreEnvelopeFailureReason };

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function validateRestoreEnvelope(
  input: RestoreEnvelopeInput,
): RestoreEnvelopeResult {
  const { expectedReportType, expectedReportId, envelope, parent } = input;

  // Cloud path: envelope present → must match.
  if (envelope !== null && envelope !== undefined) {
    if (typeof envelope !== 'object') {
      return { ok: false, reason: 'envelope_missing' };
    }
    const envType = asString((envelope as { report_type?: unknown }).report_type);
    const envId = asString((envelope as { report_id?: unknown }).report_id);
    if (!envType || !envId) {
      return { ok: false, reason: 'envelope_missing' };
    }
    if (envType !== expectedReportType) {
      return { ok: false, reason: 'envelope_type_mismatch' };
    }
    if (envId !== expectedReportId) {
      return { ok: false, reason: 'envelope_id_mismatch' };
    }
  }

  // Parent identity check (both paths).
  if (!parent || typeof parent !== 'object') {
    // Shape validator owns the "missing parent" failure mode; the envelope
    // check returns ok here so the caller's next step surfaces the right
    // shape reason. Identity-mismatch checks below only run when parent is
    // present.
    return { ok: true };
  }
  const parentId = asString((parent as { id?: unknown }).id);
  if (parentId && parentId !== expectedReportId) {
    return { ok: false, reason: 'parent_id_mismatch' };
  }
  const parentType = asString((parent as { report_type?: unknown }).report_type);
  if (parentType && parentType !== expectedReportType) {
    return { ok: false, reason: 'parent_type_mismatch' };
  }
  return { ok: true };
}
