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
 */
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
