/**
 * Slice 5B — Pre-write gate orchestrator (pure, no IDB / no React).
 *
 * Combines envelope + shape + freshness + completion-lock validators into
 * a single decision in one call. The component handlers in
 * `DataRecoveryTool.tsx` invoke this twice:
 *
 *   1. Pre-confirm pass (before the dialog opens, without holding the
 *      restore lock).
 *   2. In-lock re-check after the dialog resolves with confirm — using a
 *      freshly re-read live parent — to close the confirm→write race.
 *
 * This helper does NOT perform IDB reads itself; callers supply
 * `liveParent` so the same function is trivially testable with synthetic
 * fixtures and so the call sites stay inline in `DataRecoveryTool.tsx`
 * (no production restore-flow extraction — see Slice 5A acceptance).
 */

import type { ReportType } from '@/lib/local-backup-ledger';
import {
  validateRestoreEnvelope,
  type RestoreEnvelopeInput,
  type RestoreEnvelopeResult,
} from './restore-envelope';
import {
  validateSnapshotShape,
  type RestoreShapeResult,
} from './restore-shape';
import {
  compareSnapshotFreshness,
  type SnapshotFreshness,
} from './restore-stale';
import { isReportCompletedLocked } from './restore-completion-lock';
import {
  evaluateRestoreGate,
  type RestoreGateResult,
} from './restore-gate';

export interface RunRestoreGateInput {
  expectedReportType: ReportType;
  expectedReportId: string;
  envelope: RestoreEnvelopeInput['envelope'];
  snapshot: { parent?: unknown; children?: unknown } | null | undefined;
  /** Live parent already read from IDB by the caller. `null` if not found. */
  liveParent: Record<string, unknown> | null;
  isAdmin: boolean;
}

export interface RunRestoreGateOutput {
  gate: RestoreGateResult;
  /** Present only when shape validation succeeded — handed back to the caller for save calls. */
  validated?: Extract<RestoreShapeResult, { ok: true }>;
  freshness: SnapshotFreshness;
  locked: boolean;
}

export function runRestoreGate(input: RunRestoreGateInput): RunRestoreGateOutput {
  const envelope = validateRestoreEnvelope({
    expectedReportType: input.expectedReportType,
    expectedReportId: input.expectedReportId,
    envelope: input.envelope,
    parent: (input.snapshot as { parent?: Record<string, unknown> })?.parent ?? null,
  });
  const shape = validateSnapshotShape({
    expectedReportType: input.expectedReportType,
    snapshot: input.snapshot ?? null,
  });

  const snapshotUpdatedAt = shape.ok
    ? (shape.parent as { updated_at?: unknown }).updated_at
    : null;
  const liveUpdatedAt = input.liveParent
    ? (input.liveParent as { updated_at?: unknown }).updated_at
    : null;
  const freshness = compareSnapshotFreshness({
    snapshotUpdatedAt,
    liveUpdatedAt,
    liveMissing: input.liveParent === null,
  });
  const locked = isReportCompletedLocked({ liveParent: input.liveParent });

  const gate = evaluateRestoreGate({
    envelope,
    shape,
    freshness,
    completionLocked: locked,
    isAdmin: input.isAdmin,
  });

  return {
    gate,
    validated: shape.ok ? shape : undefined,
    freshness,
    locked,
  };
}

/**
 * User-facing toast strings for `block` reasons. Generic by design —
 * never includes the rejected child key, report id, or any other
 * sensitive metadata. Logs use the Slice 5A sanitizer instead.
 */
export function blockReasonToast(
  result: Extract<RestoreGateResult, { kind: 'block' }>,
): string {
  switch (result.reason) {
    case 'envelope_missing':
    case 'envelope_type_mismatch':
    case 'envelope_id_mismatch':
    case 'parent_type_mismatch':
    case 'parent_id_mismatch':
      return 'This backup does not match the selected report and cannot be restored.';
    case 'parent_missing':
    case 'parent_id_missing':
    case 'children_not_object':
    case 'child_not_array':
    case 'child_key_unknown':
      return 'This backup contains unrecognized data and cannot be restored safely.';
    case 'locked_non_admin':
      return 'This report is locked. Only an admin can restore over a completed report.';
    default:
      return 'This backup cannot be restored.';
  }
}
