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

// ─── Live-form state guard ──────────────────────────────────────────────────
//
// `applyIncomingSummary` is the centralised entry point that every
// background-driven Training summary state change (IDB load, server refetch,
// "no server row" fallback, local-backup restore, JSON import) MUST flow
// through. It is intentionally STRICTER than the sync/cache boundary helper
// above:
//
//   - It NEVER replaces a populated local field with a blank/null/missing
//     incoming value unless the incoming row carries an explicit
//     `field_timestamps[field]` STRICTLY newer than the local explicit
//     per-field timestamp. Row-level `updated_at` alone is NOT proof of an
//     intentional cross-device clear.
//   - For both-populated fields it KEEPS the local value unless the incoming
//     row carries an explicit per-field timestamp strictly newer than the
//     local effective timestamp. Server upserts strip `field_timestamps`
//     (see `sanitizeTrainingSummaryForRemote`), so a server echo with a
//     freshly-stamped row-level `updated_at` can NEVER shorten or replace
//     live editor text. This is the live-state fix for the
//     "text disappears during hard save" race.
//   - It NEVER replaces a populated local row with `null`/`undefined` or
//     with an empty `{ id, training_id }` placeholder.
//
// Intentional in-form clears keep working: they flow through
// `updateSummaryField` (NOT through this helper), which stamps the local
// value + local field_timestamps and updates IDB on the next autosave.
// `applyIncomingSummary` only governs what BACKGROUND data can do to the
// React state the user is currently editing.

import { recordSummaryTrace, fieldValueLength, type SummaryTraceSource, type SummaryTraceEntry } from './training-summary-trace';

export interface ApplyIncomingSummaryOptions {
  source: SummaryTraceSource;
  trainingId?: string | null;
  /** Save sequence the incoming data was produced under (for stale-skip telemetry). */
  incomingSaveSeq?: number | null;
  /** Current save sequence at apply time. */
  currentSaveSeq?: number | null;
  /** Form dirty flag at apply time. */
  hasUnsaved?: boolean;
  /** Was focus inside the Summary card. */
  focusInEditor?: boolean;
}

export interface ApplyIncomingSummaryResult<T> {
  /** The row to commit via `setSummary`. May be `prev` when nothing should change. */
  next: T | null;
  /** True when at least one field decision deviated from a naive replace. */
  guarded: boolean;
  /** Fields that were preserved (incoming wanted to blank/shorten them). */
  preservedFields: string[];
  /** Fields whose explicit incoming clear was honoured (a real cross-device clear). */
  acceptedClears: string[];
}

export function applyIncomingSummary<T extends MergeableSummaryRow>(
  prev: T | null | undefined,
  incoming: T | null | undefined,
  opts: ApplyIncomingSummaryOptions,
): ApplyIncomingSummaryResult<T> {
  const traceBase = {
    trainingId: opts.trainingId ?? null,
    hasUnsaved: !!opts.hasUnsaved,
    focusInEditor: !!opts.focusInEditor,
    incomingSaveSeq: opts.incomingSaveSeq ?? null,
    currentSaveSeq: opts.currentSaveSeq ?? null,
  } as const;

  // Case A: no incoming at all. NEVER blank prev. Includes the
  // "no server row + IDB empty" branch that previously replaced React state
  // with a fresh placeholder.
  if (incoming === null || incoming === undefined) {
    if (prev) {
      recordSummaryTrace({
        ...traceBase,
        field: 'row',
        source: 'placeholder-clobber-blocked',
        prevLen: 1,
        nextLen: 0,
        hadExplicitClear: false,
        blocked: true,
      });
    }
    return { next: (prev ?? null) as T | null, guarded: !!prev, preservedFields: [], acceptedClears: [] };
  }

  // Case B: prev is missing or a fresh placeholder. Accept incoming wholesale
  // (this is the admin-opens-foreign-report path).
  if (!prev || isEmptyPlaceholderSummary(prev)) {
    recordSummaryTrace({
      ...traceBase,
      field: 'row',
      source: opts.source,
      prevLen: 0,
      nextLen: 1,
      hadExplicitClear: false,
      blocked: false,
    });
    return { next: incoming as T, guarded: false, preservedFields: [], acceptedClears: [] };
  }

  // Case C: per-field guarded merge.
  const merged: T = { ...incoming, ...prev } as T;
  const mergedTimestamps: Record<string, string> = {
    ...((incoming.field_timestamps as Record<string, string> | null) ?? {}),
    ...((prev.field_timestamps as Record<string, string> | null) ?? {}),
  };
  const preservedFields: string[] = [];
  const acceptedClears: string[] = [];
  let guarded = false;

  for (const field of TRAINING_SUMMARY_FIELDS) {
    const prevVal = (prev as Record<string, unknown>)[field];
    const incomingVal = (incoming as Record<string, unknown>)[field];
    const prevMissing = isTrainingSummaryFieldMissing(prevVal);
    const incomingMissing = isTrainingSummaryFieldMissing(incomingVal);

    const prevExplicitMs = explicitFieldTimestampMs(prev, field);
    const incomingExplicitMs = explicitFieldTimestampMs(incoming, field);
    const incomingHasExplicitNewerClear =
      Number.isFinite(incomingExplicitMs) &&
      (!Number.isFinite(prevExplicitMs) || incomingExplicitMs > prevExplicitMs);

    // Both missing — nothing to decide.
    if (prevMissing && incomingMissing) {
      (merged as Record<string, unknown>)[field] = prevVal ?? incomingVal;
      continue;
    }

    // Prev missing, incoming populated — accept.
    if (prevMissing && !incomingMissing) {
      (merged as Record<string, unknown>)[field] = incomingVal;
      const ts = (incoming.field_timestamps as Record<string, string> | null)?.[field];
      if (ts) mergedTimestamps[field] = ts;
      continue;
    }

    // Prev populated, incoming missing — preserve UNLESS explicit cross-device clear.
    if (!prevMissing && incomingMissing) {
      if (incomingHasExplicitNewerClear) {
        (merged as Record<string, unknown>)[field] = incomingVal;
        const ts = (incoming.field_timestamps as Record<string, string> | null)?.[field];
        if (ts) mergedTimestamps[field] = ts;
        acceptedClears.push(field);
        recordSummaryTrace({
          ...traceBase,
          field: field as SummaryTraceEntry['field'],
          source: opts.source,
          prevLen: fieldValueLength(prevVal),
          nextLen: 0,
          hadExplicitClear: true,
          blocked: false,
        });
      } else {
        (merged as Record<string, unknown>)[field] = prevVal;
        const ts = (prev.field_timestamps as Record<string, string> | null)?.[field];
        if (ts) mergedTimestamps[field] = ts;
        preservedFields.push(field);
        guarded = true;
        recordSummaryTrace({
          ...traceBase,
          field: field as SummaryTraceEntry['field'],
          source: opts.source,
          prevLen: fieldValueLength(prevVal),
          nextLen: 0,
          hadExplicitClear: false,
          blocked: true,
        });
      }
      continue;
    }

    // Both populated — keep prev unless incoming has explicit newer per-field stamp.
    const prevEffectiveMs = summaryFieldTimestampMs(prev, field);
    if (
      Number.isFinite(incomingExplicitMs) &&
      incomingExplicitMs > prevEffectiveMs
    ) {
      (merged as Record<string, unknown>)[field] = incomingVal;
      const ts = (incoming.field_timestamps as Record<string, string> | null)?.[field];
      if (ts) mergedTimestamps[field] = ts;
      // This is a legitimate cross-device update — not a "clear" — so don't
      // record it as acceptedClears. Still emit a trace for forensics.
      recordSummaryTrace({
        ...traceBase,
        field: field as SummaryTraceEntry['field'],
        source: opts.source,
        prevLen: fieldValueLength(prevVal),
        nextLen: fieldValueLength(incomingVal),
        hadExplicitClear: false,
        blocked: false,
      });
    } else {
      (merged as Record<string, unknown>)[field] = prevVal;
      const ts = (prev.field_timestamps as Record<string, string> | null)?.[field];
      if (ts) mergedTimestamps[field] = ts;
      // Only count as "guarded" when incoming wanted a different value.
      if (prevVal !== incomingVal) {
        preservedFields.push(field);
        guarded = true;
        recordSummaryTrace({
          ...traceBase,
          field: field as SummaryTraceEntry['field'],
          source: opts.source,
          prevLen: fieldValueLength(prevVal),
          nextLen: fieldValueLength(incomingVal),
          hadExplicitClear: false,
          blocked: true,
        });
      }
    }
  }

  if (Object.keys(mergedTimestamps).length > 0) {
    (merged as MergeableSummaryRow).field_timestamps = mergedTimestamps;
  }

  // Preserve the local `updated_at` whenever ANY field was preserved — the
  // local row is authoritative for those fields, so the row-level timestamp
  // must not regress to the incoming row's stamp.
  if (guarded && typeof (prev as MergeableSummaryRow).updated_at === 'string') {
    (merged as MergeableSummaryRow).updated_at = (prev as MergeableSummaryRow).updated_at;
  }

  return { next: merged, guarded, preservedFields, acceptedClears };
}

// Re-export the trace types so callers can import everything from one module
// when convenient. The trace ring itself lives in `training-summary-trace.ts`.
export type { SummaryTraceEntry } from './training-summary-trace';

// ─── Save-sequence / save-finally race guards ──────────────────────────────
//
// Tiny pure predicates extracted from `TrainingForm` so the save-finally
// dirty-state guard and the refetch "pending-confirmed" guard can be
// unit-tested without rendering the form. They MUST stay behaviorally
// identical to the inline checks in `TrainingForm.tsx` — callers and tests
// rely on the same wall-clock semantics.

export interface TypedAfterInput {
  /** `pendingSummaryFieldsRef.current` — field → ISO timestamp string. */
  pendingFieldTimestamps: Record<string, string> | null | undefined;
  /** Reference time (e.g. `saveStartedAtRef.current`) in ms since epoch. */
  sinceMs: number;
}

/**
 * Returns true when ANY pending Training summary field carries an ISO
 * timestamp strictly newer than `sinceMs`. Used by the refetch /
 * Realtime-echo branch to refuse to clear `pendingSummaryFieldsRef` when an
 * OLDER save's response arrives after the user kept typing.
 */
export function summaryTypedAfter({ pendingFieldTimestamps, sinceMs }: TypedAfterInput): boolean {
  const pending = pendingFieldTimestamps ?? {};
  if (!Number.isFinite(sinceMs)) return false;
  for (const v of Object.values(pending)) {
    if (typeof v !== 'string' || !v) continue;
    const ms = new Date(v).getTime();
    if (Number.isFinite(ms) && ms > sinceMs) return true;
  }
  return false;
}

export interface ShouldKeepDirtyInput {
  /** `pendingSummaryFieldsRef.current` at the end of the save. */
  pendingFieldTimestamps: Record<string, string> | null | undefined;
  /** `summaryRef.current?.updated_at` at the end of the save. */
  summaryUpdatedAt: string | null | undefined;
  /** Wall-clock ms captured when THIS save invocation started. */
  saveStartedAtMs: number;
}

/**
 * Save-finally dirty-state guard. Returns true when `hasUnsavedRef` and
 * `hasUnsavedChanges` MUST stay set after a successful save — because the
 * user typed a protected summary field after this save started, or because
 * the live summary row was updated in-place after save start.
 *
 * Returning false means it is safe to mark the form clean.
 */
export function shouldKeepDirtyAfterSave({
  pendingFieldTimestamps,
  summaryUpdatedAt,
  saveStartedAtMs,
}: ShouldKeepDirtyInput): boolean {
  if (!Number.isFinite(saveStartedAtMs)) return false;
  if (summaryTypedAfter({ pendingFieldTimestamps, sinceMs: saveStartedAtMs })) return true;
  if (typeof summaryUpdatedAt === 'string' && summaryUpdatedAt) {
    const ms = new Date(summaryUpdatedAt).getTime();
    if (Number.isFinite(ms) && ms > saveStartedAtMs) return true;
  }
  return false;
}


