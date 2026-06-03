/**
 * Slice 5B — Restore gate.
 *
 * Pure module: composes the envelope, shape, freshness, completion-lock,
 * and role inputs into a single decision the UI can map to either a
 * fail-closed toast or a confirmation dialog variant.
 *
 * Variants:
 *   block                       — no user prompt; surface toast and abort
 *   confirm_normal              — standard "replace local with backup?"
 *   confirm_stale               — backup is older than current local
 *   confirm_locked              — local report is completed/locked
 *   confirm_stale_and_locked    — both at once
 *
 * `confirm_locked` and `confirm_stale_and_locked` require `isAdmin === true`
 * for the user to be allowed to proceed; non-admins receive a hard-block
 * variant that renders an "OK" acknowledgement with no proceed action.
 *
 * Escalation ordering (for in-lock re-check):
 *   confirm_normal < confirm_stale < confirm_locked < confirm_stale_and_locked
 * If the in-lock re-evaluation produces a strictly-higher variant than
 * what the user confirmed, the caller MUST abort with zero mutation.
 * `rankRestoreGate` exposes this ordering for the caller.
 */

import type {
  RestoreEnvelopeFailureReason,
  RestoreEnvelopeResult,
} from './restore-envelope';
import type {
  RestoreShapeFailureReason,
  RestoreShapeResult,
} from './restore-shape';
import type { SnapshotFreshness } from './restore-stale';

export type RestoreGateConfirmVariant =
  | 'confirm_normal'
  | 'confirm_stale'
  | 'confirm_locked'
  | 'confirm_stale_and_locked';

export type RestoreGateBlockReason =
  | RestoreEnvelopeFailureReason
  | RestoreShapeFailureReason
  | 'locked_non_admin';

export type RestoreGateResult =
  | { kind: 'block'; reason: RestoreGateBlockReason }
  | {
      kind: 'confirm';
      variant: RestoreGateConfirmVariant;
      /** True iff the user is permitted to proceed past this variant. */
      canProceed: boolean;
      /** Whether this variant requires admin to proceed at all. */
      requiresAdmin: boolean;
      stale: boolean;
      locked: boolean;
    };

export interface EvaluateRestoreGateInput {
  envelope: RestoreEnvelopeResult;
  shape: RestoreShapeResult;
  freshness: SnapshotFreshness;
  completionLocked: boolean;
  isAdmin: boolean;
}

export function evaluateRestoreGate(
  input: EvaluateRestoreGateInput,
): RestoreGateResult {
  if (!input.envelope.ok) {
    return { kind: 'block', reason: input.envelope.reason };
  }
  if (!input.shape.ok) {
    return { kind: 'block', reason: input.shape.reason };
  }

  // 'unknown' freshness is gated as 'stale' — never silently fresh.
  const stale = input.freshness !== 'fresh';
  const locked = input.completionLocked;

  let variant: RestoreGateConfirmVariant;
  if (stale && locked) variant = 'confirm_stale_and_locked';
  else if (locked) variant = 'confirm_locked';
  else if (stale) variant = 'confirm_stale';
  else variant = 'confirm_normal';

  const requiresAdmin = variant === 'confirm_locked' || variant === 'confirm_stale_and_locked';

  if (requiresAdmin && !input.isAdmin) {
    return { kind: 'block', reason: 'locked_non_admin' };
  }

  return {
    kind: 'confirm',
    variant,
    canProceed: requiresAdmin ? input.isAdmin : true,
    requiresAdmin,
    stale,
    locked,
  };
}

const VARIANT_RANK: Record<RestoreGateConfirmVariant, number> = {
  confirm_normal: 0,
  confirm_stale: 1,
  confirm_locked: 2,
  confirm_stale_and_locked: 3,
};

/**
 * Compare two confirm variants. Returns a negative number when `a` is
 * strictly less restrictive than `b`, zero when equal, positive when
 * `a` is more restrictive. `block` results are considered strictly more
 * restrictive than any confirm variant.
 */
export function compareRestoreGateRestrictiveness(
  a: RestoreGateResult,
  b: RestoreGateResult,
): number {
  if (a.kind === 'block' && b.kind === 'block') return 0;
  if (a.kind === 'block') return 1;
  if (b.kind === 'block') return -1;
  return VARIANT_RANK[a.variant] - VARIANT_RANK[b.variant];
}
