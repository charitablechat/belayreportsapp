/**
 * Slice 5C — Admin server-restore pre-write gate orchestrator.
 *
 * Pure module: no React, no IDB, no Supabase, no toast, no logging.
 *
 * Composes admin envelope + admin shape + freshness (reused from 5B) +
 * completion-lock (reused from 5B) + role checks into a single decision
 * the All User Snapshots and Admin Edit History handlers can act on
 * before any server-side mutation.
 *
 * The handlers invoke this twice:
 *   1. Pre-confirm pass (before the dialog opens, lock NOT held).
 *   2. In-lock re-check after the dialog resolves with confirm — using a
 *      freshly re-read live server parent — to close the confirm→write
 *      race. The handlers ALSO re-fetch the snapshot row inside the lock
 *      and compare `fingerprintAdminSnapshot()` to close the snapshot-row
 *      TOCTOU window (admin snapshot rows are append-only in practice,
 *      but we re-validate regardless).
 *
 * This helper does NOT perform Supabase reads itself; callers supply the
 * snapshot row and live parent so it stays trivially testable with
 * synthetic fixtures.
 */

import {
  validateAdminRestoreEnvelope,
  type AdminRestoreEnvelopeResult,
  type AdminRestoreEnvelopeFailureReason,
} from './admin-restore-envelope';
import {
  validateAdminSnapshotShape,
  type AdminRestoreShapeResult,
  type AdminRestoreShapeFailureReason,
  type AdminRestoreReportType,
} from './admin-restore-shape';
import {
  compareSnapshotFreshness,
  type SnapshotFreshness,
} from './restore-stale';
import { isReportCompletedLocked } from './restore-completion-lock';

export type AdminRestoreGateConfirmVariant =
  | 'confirm_normal'
  | 'confirm_stale'
  | 'confirm_locked'
  | 'confirm_stale_and_locked';

export type AdminRestoreGateBlockReason =
  | AdminRestoreEnvelopeFailureReason
  | AdminRestoreShapeFailureReason
  | 'not_admin'
  | 'role_unknown'
  | 'live_read_error';

export type AdminRestoreGateResult =
  | { kind: 'block'; reason: AdminRestoreGateBlockReason }
  | {
      kind: 'confirm';
      variant: AdminRestoreGateConfirmVariant;
      stale: boolean;
      locked: boolean;
      reportType: AdminRestoreReportType;
      reportId: string;
    };

export interface RunAdminRestoreGateInput {
  /** The raw snapshot row (report_cloud_backups or admin_edit_snapshots). */
  snapshotRow: {
    report_type?: unknown;
    report_id?: unknown;
    snapshot_data?: unknown;
  } | null | undefined;
  /**
   * Live server parent. `null` = parent row not found on server (treat as
   * insert-equivalent). `'read-error'` = the live read failed; gate must
   * block to avoid an unsafe write decision.
   */
  liveParent: Record<string, unknown> | null | 'read-error';
  /** From useRoleStatus. `null` while loading. */
  isAdmin: boolean | null;
  /** True while useRoleStatus is still loading. */
  roleLoading: boolean;
}

export interface RunAdminRestoreGateOutput {
  gate: AdminRestoreGateResult;
  envelope: AdminRestoreEnvelopeResult;
  shape?: Extract<AdminRestoreShapeResult, { ok: true }>;
  freshness: SnapshotFreshness;
  locked: boolean;
}

export function runAdminRestoreGate(
  input: RunAdminRestoreGateInput,
): RunAdminRestoreGateOutput {
  // Role precheck (fail-closed). Live read / envelope / shape only run
  // after we have admin confirmation.
  if (input.roleLoading || input.isAdmin === null) {
    return {
      gate: { kind: 'block', reason: 'role_unknown' },
      envelope: { ok: false, reason: 'envelope_missing' },
      freshness: 'unknown',
      locked: false,
    };
  }
  if (input.isAdmin !== true) {
    return {
      gate: { kind: 'block', reason: 'not_admin' },
      envelope: { ok: false, reason: 'envelope_missing' },
      freshness: 'unknown',
      locked: false,
    };
  }

  const envelope = validateAdminRestoreEnvelope({ row: input.snapshotRow ?? null });
  if (envelope.ok === false) {
    return {
      gate: { kind: 'block', reason: envelope.reason },
      envelope,
      freshness: 'unknown',
      locked: false,
    };
  }

  const sd = (input.snapshotRow as { snapshot_data?: unknown } | null | undefined)
    ?.snapshot_data as { parent?: unknown; children?: unknown } | null | undefined;
  const shape = validateAdminSnapshotShape({
    expectedReportType: envelope.reportType,
    snapshotData: sd ?? null,
  });
  if (shape.ok === false) {
    return {
      gate: { kind: 'block', reason: shape.reason },
      envelope,
      freshness: 'unknown',
      locked: false,
    };
  }

  if (input.liveParent === 'read-error') {
    return {
      gate: { kind: 'block', reason: 'live_read_error' },
      envelope,
      shape,
      freshness: 'unknown',
      locked: false,
    };
  }

  const snapshotUpdatedAt = (shape.parent as { updated_at?: unknown }).updated_at;
  const liveUpdatedAt = input.liveParent
    ? (input.liveParent as { updated_at?: unknown }).updated_at
    : null;
  const freshness = compareSnapshotFreshness({
    snapshotUpdatedAt,
    liveUpdatedAt,
    liveMissing: input.liveParent === null,
  });
  const locked = isReportCompletedLocked({ liveParent: input.liveParent });

  // 'unknown' freshness is treated as 'stale' — never silently fresh.
  const stale = freshness !== 'fresh';

  let variant: AdminRestoreGateConfirmVariant;
  if (stale && locked) variant = 'confirm_stale_and_locked';
  else if (locked) variant = 'confirm_locked';
  else if (stale) variant = 'confirm_stale';
  else variant = 'confirm_normal';

  return {
    gate: {
      kind: 'confirm',
      variant,
      stale,
      locked,
      reportType: envelope.reportType,
      reportId: envelope.reportId,
    },
    envelope,
    shape,
    freshness,
    locked,
  };
}

const VARIANT_RANK: Record<AdminRestoreGateConfirmVariant, number> = {
  confirm_normal: 0,
  confirm_stale: 1,
  confirm_locked: 2,
  confirm_stale_and_locked: 3,
};

/**
 * Compare two admin gate results. Returns >0 when `a` is strictly more
 * restrictive than `b`. Used for the in-lock escalation re-check: if the
 * fresh gate is strictly more restrictive than what the user confirmed,
 * the handler MUST abort with zero mutation.
 */
export function compareAdminRestoreGateRestrictiveness(
  a: AdminRestoreGateResult,
  b: AdminRestoreGateResult,
): number {
  if (a.kind === 'block' && b.kind === 'block') return 0;
  if (a.kind === 'block') return 1;
  if (b.kind === 'block') return -1;
  return VARIANT_RANK[a.variant] - VARIANT_RANK[b.variant];
}

/**
 * Stable fingerprint of an admin snapshot row, derived from the fields
 * we validate. Used to close the snapshot-row TOCTOU window: callers
 * compute the fingerprint at pre-confirm time, re-fetch the row inside
 * the restore lock, recompute the fingerprint, and abort if they differ.
 *
 * NEVER logged user-facing. Designed to expose ONLY structural identity
 * (type / id / parent.id / parent.updated_at / per-table row counts) —
 * no raw report body, notes, photos, organization, location, client names.
 */
export function fingerprintAdminSnapshot(row: {
  report_type?: unknown;
  report_id?: unknown;
  snapshot_data?: unknown;
} | null | undefined): string {
  if (!row || typeof row !== 'object') return 'null';
  const reportType = typeof row.report_type === 'string' ? row.report_type : 'x';
  const reportId = typeof row.report_id === 'string' ? row.report_id : 'x';
  const sd = (row as { snapshot_data?: unknown }).snapshot_data;
  let parentId = 'x';
  let parentUpdated = 'x';
  let childSig = '';
  if (sd && typeof sd === 'object') {
    const parent = (sd as { parent?: unknown }).parent;
    if (parent && typeof parent === 'object') {
      const pid = (parent as { id?: unknown }).id;
      if (typeof pid === 'string') parentId = pid;
      const pu = (parent as { updated_at?: unknown }).updated_at;
      if (typeof pu === 'string' || typeof pu === 'number') {
        parentUpdated = String(pu);
      }
    }
    const children = (sd as { children?: unknown }).children;
    if (children && typeof children === 'object' && !Array.isArray(children)) {
      childSig = Object.entries(children as Record<string, unknown>)
        .map(([k, v]) => `${k}:${Array.isArray(v) ? v.length : 'x'}`)
        .sort()
        .join(',');
    }
  }
  return [reportType, reportId, parentId, parentUpdated, childSig].join('|');
}

/**
 * User-facing toast strings for admin-restore block reasons. Generic by
 * design — never includes the rejected child key, report id, or any
 * other sensitive metadata.
 */
export function adminBlockReasonToast(
  result: Extract<AdminRestoreGateResult, { kind: 'block' }>,
): string {
  switch (result.reason) {
    case 'role_unknown':
      return 'Permission check unavailable — restore cancelled. Please refresh and try again.';
    case 'not_admin':
      return 'Only an administrator can perform this restore.';
    case 'envelope_missing':
    case 'envelope_type_unknown':
    case 'envelope_id_missing':
    case 'parent_id_mismatch':
    case 'parent_type_mismatch':
      return 'This snapshot does not match the selected report and cannot be restored.';
    case 'parent_missing':
    case 'parent_id_missing':
    case 'children_not_object':
    case 'child_key_unknown':
    case 'child_not_array':
      return 'This snapshot contains unrecognized data and cannot be restored safely.';
    case 'live_read_error':
      return 'Could not read the current server record. Restore cancelled — please retry.';
    default:
      return 'This snapshot cannot be restored.';
  }
}
