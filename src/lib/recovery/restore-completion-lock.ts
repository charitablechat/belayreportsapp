/**
 * Slice 5B — Completion-lock detector.
 *
 * Pure module: no React, no IDB, no Supabase, no toast, no logging.
 *
 * All three report types (inspection, training, daily_assessment) use the
 * same `status === 'completed'` sentinel to indicate a locked report
 * (see mem://features/report-completion-lock-v6). Restore writing over
 * a completed report silently re-opens it; non-admins must be hard-blocked
 * and admins must explicitly override.
 */

export interface CompletionLockInput {
  liveParent: Record<string, unknown> | null | undefined;
}

export function isReportCompletedLocked(input: CompletionLockInput): boolean {
  const p = input.liveParent;
  if (!p || typeof p !== 'object') return false;
  const status = (p as { status?: unknown }).status;
  return typeof status === 'string' && status === 'completed';
}
