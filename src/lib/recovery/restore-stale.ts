/**
 * Slice 5B — Stale-snapshot comparison.
 *
 * Pure module: no React, no IDB, no Supabase, no toast, no logging.
 *
 * Returns:
 *   'fresh'   — snapshot is at least as new as live, or there is no live record
 *   'stale'   — live record is strictly newer than snapshot
 *   'unknown' — either side is missing or unparseable
 *
 * Policy: callers MUST treat 'unknown' the same as 'stale' for gating
 * (require explicit user confirmation). Never silently treat 'unknown'
 * as 'fresh'.
 */

export type SnapshotFreshness = 'fresh' | 'stale' | 'unknown';

export interface SnapshotFreshnessInput {
  snapshotUpdatedAt: unknown;
  /** Pass `null` / `undefined` when no live record exists locally. */
  liveUpdatedAt: unknown;
  /** When true, the live record was not found at all → freshness is `fresh`. */
  liveMissing?: boolean;
}

function toMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function compareSnapshotFreshness(
  input: SnapshotFreshnessInput,
): SnapshotFreshness {
  if (input.liveMissing) return 'fresh';
  const snapMs = toMs(input.snapshotUpdatedAt);
  const liveMs = toMs(input.liveUpdatedAt);
  if (snapMs === null || liveMs === null) return 'unknown';
  if (liveMs > snapMs) return 'stale';
  return 'fresh';
}
