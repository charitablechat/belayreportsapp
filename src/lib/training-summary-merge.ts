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
 *   - `mergeTrainingSummaryAtBoundary` is the SYNC/CACHE-boundary variant
 *     used by `refetchTrainingPackage`, `syncTrainingAtomic`,
 *     `pushTrainingToRemote`, `completeTraining`, and the service-worker
 *     replay. It enforces the same "populated wins over blank without
 *     explicit field-level clear evidence" rule on both directions
 *     (server → local cache, local → server upsert) so a stale blank
 *     payload from EITHER side cannot wipe non-empty text.
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

/**
 * Returns the strictly-explicit per-field timestamp (from `field_timestamps`)
 * if present, else NaN. Unlike `summaryFieldTimestampMs`, this NEVER falls
 * back to row-level `updated_at` — which is the whole point of the boundary
 * preservation guard: a fresh row-level updated_at on a blank summary row
 * is NOT proof that the user cleared that specific field.
 */
function explicitFieldTimestampMs(row: Row, field: string): number {
  const explicit = (row?.field_timestamps as Record<string, string> | null | undefined)?.[field];
  if (typeof explicit !== 'string' || !explicit) return Number.NaN;
  const ms = new Date(explicit).getTime();
  return Number.isFinite(ms) ? ms : Number.NaN;
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
export function isTrainingSummaryFieldMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const stripped = value.replace(/<p><\/p>/g, '').replace(/<br\s*\/?>/g, '').trim();
    return stripped.length === 0;
  }
  return false;
}

// Internal alias used by the existing merge below.
const isFieldMissing = isTrainingSummaryFieldMissing;

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

// ─── Sync / cache boundary preservation ────────────────────────────────────

export interface SummaryPreservationBreadcrumb {
  field: (typeof TRAINING_SUMMARY_FIELDS)[number];
  /** Which side was empty (the one whose blank was vetoed). */
  blankSide: 'a' | 'b';
  /** Which side was populated (the one whose value was preserved). */
  populatedSide: 'a' | 'b';
  /** Length of the preserved value (chars). Never the value itself. */
  preservedLength: number;
  /** Reason the blank was not accepted. */
  reason: 'no_explicit_field_clear' | 'explicit_clear_older_than_populated';
}

export interface BoundaryMergeResult<T> {
  /** Merged row containing the 4 protected fields + merged field_timestamps. */
  merged: T;
  /** Per-field decisions where a blank was blocked. Empty when no preservation fired. */
  preservations: SummaryPreservationBreadcrumb[];
}

/**
 * Bidirectional preservation merge for the FOUR protected `training_summary`
 * fields, designed for sync / cache / save boundaries (NOT form hydration).
 *
 * Per-field rule, applied independently to `observations`,
 * `recommendations`, `person_submitting`, `submission_date`:
 *
 *   1. Both sides empty (null / undefined / whitespace / TipTap "<p></p>") →
 *      keep empty.
 *   2. Both sides populated → pick the side with the greater EFFECTIVE
 *      per-field timestamp. Effective timestamp is the explicit
 *      `field_timestamps[field]` when present, else row-level `updated_at`.
 *      Tie → keep `a`.
 *   3. One side populated, the other empty → keep the populated side
 *      UNLESS the empty side carries an explicit
 *      `field_timestamps[field]` that is strictly newer than the
 *      populated side's effective timestamp. Row-level `updated_at` alone
 *      is NOT proof of an explicit user clear.
 *
 * The merged row's `field_timestamps[field]` is set to the explicit
 * timestamp of whichever side won (when available), so the next merge
 * cycle still has accurate per-field metadata.
 *
 * Callers SHOULD pass the IDB-shaped row for the local side and the
 * server-shaped row for the remote side; the function does not care which
 * is "a" vs "b" — preservation is symmetric.
 */
export function mergeTrainingSummaryAtBoundary<T extends MergeableSummaryRow>(
  a: T | null | undefined,
  b: T | null | undefined,
): BoundaryMergeResult<T> {
  const aSafe = (a ?? {}) as T;
  const bSafe = (b ?? {}) as T;

  // Seed merged: prefer b (incoming/server) for non-protected metadata,
  // overlay a so any local IDs / FKs survive.
  const merged = { ...bSafe, ...aSafe } as T;
  const mergedTimestamps: Record<string, string> = {
    ...((bSafe.field_timestamps as Record<string, string> | null) ?? {}),
    ...((aSafe.field_timestamps as Record<string, string> | null) ?? {}),
  };
  const preservations: SummaryPreservationBreadcrumb[] = [];

  for (const field of TRAINING_SUMMARY_FIELDS) {
    const aVal = (aSafe as Record<string, unknown>)[field];
    const bVal = (bSafe as Record<string, unknown>)[field];
    const aMissing = isFieldMissing(aVal);
    const bMissing = isFieldMissing(bVal);

    // Case 1: both missing.
    if (aMissing && bMissing) {
      (merged as Record<string, unknown>)[field] = aMissing && aVal === undefined ? bVal : aVal;
      continue;
    }

    // Case 2: both populated — LWW on effective timestamp.
    if (!aMissing && !bMissing) {
      const aMs = summaryFieldTimestampMs(aSafe, field);
      const bMs = summaryFieldTimestampMs(bSafe, field);
      const useA = aMs >= bMs; // tie → a
      (merged as Record<string, unknown>)[field] = useA ? aVal : bVal;
      const winnerExplicit = useA
        ? aSafe.field_timestamps?.[field]
        : bSafe.field_timestamps?.[field];
      if (winnerExplicit) mergedTimestamps[field] = winnerExplicit;
      continue;
    }

    // Case 3: exactly one side populated.
    const populatedSide: 'a' | 'b' = aMissing ? 'b' : 'a';
    const blankSide: 'a' | 'b' = aMissing ? 'a' : 'b';
    const populatedVal = aMissing ? bVal : aVal;
    const populatedRow = aMissing ? bSafe : aSafe;
    const blankRow = aMissing ? aSafe : bSafe;

    const blankExplicitMs = explicitFieldTimestampMs(blankRow, field);
    const populatedEffectiveMs = summaryFieldTimestampMs(populatedRow, field);

    const explicitClearWins =
      Number.isFinite(blankExplicitMs) && blankExplicitMs > populatedEffectiveMs;

    if (explicitClearWins) {
      // Genuine explicit clear from the other device — honour it.
      (merged as Record<string, unknown>)[field] = aMissing ? aVal : bVal;
      const blankExplicit = blankRow.field_timestamps?.[field];
      if (blankExplicit) mergedTimestamps[field] = blankExplicit;
      continue;
    }

    // Preserve the populated value.
    (merged as Record<string, unknown>)[field] = populatedVal;
    const populatedExplicit = populatedRow.field_timestamps?.[field];
    if (populatedExplicit) mergedTimestamps[field] = populatedExplicit;
    preservations.push({
      field,
      blankSide,
      populatedSide,
      preservedLength: typeof populatedVal === 'string' ? populatedVal.length : 0,
      reason: Number.isFinite(blankExplicitMs)
        ? 'explicit_clear_older_than_populated'
        : 'no_explicit_field_clear',
    });
  }

  // Only attach field_timestamps when we have at least one entry.
  if (Object.keys(mergedTimestamps).length > 0) {
    (merged as MergeableSummaryRow).field_timestamps = mergedTimestamps;
  }

  return { merged, preservations };
}

/**
 * Metadata-only breadcrumb. Logs field names, lengths, and a context label.
 * NEVER logs actual summary text.
 */
export function logTrainingSummaryPreservation(
  context: string,
  trainingId: string | null | undefined,
  preservations: SummaryPreservationBreadcrumb[],
): void {
  if (preservations.length === 0) return;
  if (typeof console === 'undefined') return;
  try {
    console.info('[TrainingSummaryPreservation]', {
      context,
      trainingId: typeof trainingId === 'string' ? trainingId.substring(0, 8) : null,
      at: new Date().toISOString(),
      preservations: preservations.map((p) => ({
        field: p.field,
        blankSide: p.blankSide,
        populatedSide: p.populatedSide,
        preservedLength: p.preservedLength,
        reason: p.reason,
      })),
    });
  } catch {
    // ignore logging errors
  }
}
