/**
 * Helpers for Training Summary load/merge decisions in TrainingForm.tsx.
 *
 * Kept in a tiny module so they can be unit-tested without rendering the
 * full form. The behavior they encode is critical:
 *   - `summaryFieldTimestampMs` reads the per-field LWW timestamp the form
 *     stamps in `field_timestamps`, falling back to `updated_at`. These
 *     fields live in IDB / React state only — they are stripped before any
 *     remote write via `sanitizeTrainingSummaryForRemote`.
 *   - `isEmptyPlaceholderSummary` recognises the "fresh `{ id, training_id }`"
 *     placeholder created by setSummary on first load. Such a placeholder
 *     must NEVER beat a populated server summary during field-merge, or
 *     admin viewers reopening someone else's training will see blank
 *     Observations / Recommendations until Generate Report runs.
 *   - `mergeSummaryPreservingPopulated` runs a per-field LWW merge for the
 *     four user-editable Training Summary columns and then guards against
 *     a stale incoming row clobbering a populated local field with an
 *     empty/null value (the Android "field disappears on reload" bug). It
 *     is used by BOTH the IDB-load branch and the server-refetch branch in
 *     `TrainingForm.loadTraining` so they cannot drift apart again.
 */
import { mergeRecordFields, TRAINING_SUMMARY_FIELDS } from '@/lib/field-merge';

type Row = Record<string, unknown> | null | undefined;

export function summaryFieldTimestampMs(row: Row, field: string): number {
  const explicit = (row?.field_timestamps as Record<string, string> | null | undefined)?.[field];
  const updated = typeof row?.updated_at === 'string' ? (row.updated_at as string) : null;
  const raw = explicit || updated;
  const ms = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

export function isEmptyPlaceholderSummary(row: Row): boolean {
  if (!row) return true;
  const hasObs = typeof row.observations === 'string' && (row.observations as string).trim().length > 0;
  const hasRec = typeof row.recommendations === 'string' && (row.recommendations as string).trim().length > 0;
  const hasPerson = typeof row.person_submitting === 'string' && (row.person_submitting as string).trim().length > 0;
  const hasDate = !!row.submission_date;
  const ts = (row.field_timestamps as Record<string, string> | null | undefined) ?? null;
  const hasTimestamps = !!ts && Object.keys(ts).length > 0;
  return !hasObs && !hasRec && !hasPerson && !hasDate && !hasTimestamps;
}

/**
 * Treats a value as "missing" if it is null/undefined, or a string that is
 * empty / whitespace-only after stripping the empty-paragraph shell that
 * TipTap emits when a rich-text editor is cleared. Used by the per-field
 * "non-empty wins over empty" guard below.
 */
function isFieldMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const stripped = value.replace(/<p><\/p>/g, '').replace(/<br\s*\/?>/g, '').trim();
    return stripped.length === 0;
  }
  return false;
}

type MergeableSummaryRow = Record<string, unknown> & {
  updated_at?: string | null;
  field_timestamps?: Record<string, string> | null;
};

/**
 * Field-level LWW merge for the four user-editable `training_summary`
 * columns (`observations`, `recommendations`, `person_submitting`,
 * `submission_date`) with an additional guard:
 *
 *   If `incoming[field]` is empty/null and `local[field]` is populated
 *   and the local per-field timestamp is `>=` incoming's, the local
 *   value is preserved.
 *
 * This stops a stale IDB row (which loses its `field_timestamps` after a
 * server-refetch caches the sanitized server row) or a freshly-fetched
 * server row with not-yet-replayed sibling edits from wiping fields the
 * user just typed. The pure `mergeRecordFields` already implements LWW;
 * this wrapper layers the empty-vs-populated tiebreak on top so that an
 * older empty value can never beat a newer populated one for the same
 * field, regardless of which side it came from.
 *
 * Callers should still short-circuit with `isEmptyPlaceholderSummary` when
 * `local` is the fresh `{ id, training_id }` placeholder — that case is
 * intentionally _not_ handled here so admins reopening someone else's
 * report still see the populated server row.
 */
export function mergeSummaryPreservingPopulated<T extends MergeableSummaryRow>(
  local: T,
  incoming: T,
): T {
  const merged = mergeRecordFields(local, incoming, [...TRAINING_SUMMARY_FIELDS]) as T;

  const mergedTimestamps: Record<string, string> = {
    ...((merged.field_timestamps as Record<string, string> | null) ?? {}),
  };
  let touched = false;

  for (const field of TRAINING_SUMMARY_FIELDS) {
    const mergedValue = (merged as Record<string, unknown>)[field];
    const localValue = (local as Record<string, unknown>)[field];
    const incomingValue = (incoming as Record<string, unknown>)[field];

    // Only intervene when LWW chose an "empty" value but the OTHER side
    // had a populated value with a timestamp that is at least as new.
    // This keeps a genuinely-newer clear (user deleted the field on the
    // other device) intact, while blocking the stale-empty-wins race.
    if (!isFieldMissing(mergedValue)) continue;

    const localPopulated = !isFieldMissing(localValue);
    const incomingPopulated = !isFieldMissing(incomingValue);
    if (!localPopulated && !incomingPopulated) continue;

    const localMs = summaryFieldTimestampMs(local, field);
    const incomingMs = summaryFieldTimestampMs(incoming, field);

    let restoreValue: unknown = undefined;
    let restoreTs: string | undefined;
    if (localPopulated && localMs >= incomingMs) {
      restoreValue = localValue;
      restoreTs = local.field_timestamps?.[field];
    } else if (incomingPopulated && incomingMs > localMs) {
      restoreValue = incomingValue;
      restoreTs = incoming.field_timestamps?.[field];
    }

    if (restoreValue !== undefined) {
      (merged as Record<string, unknown>)[field] = restoreValue;
      if (restoreTs) mergedTimestamps[field] = restoreTs;
      touched = true;
    }
  }

  if (touched) {
    merged.field_timestamps = mergedTimestamps;
  }
  return merged;
}
