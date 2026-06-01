/**
 * Training Summary state-transition diagnostics ring (metadata-only).
 *
 * Purpose: give us a forensic trail when Training `observations` /
 * `recommendations` disappear in the live editor without ever logging the
 * actual report text. Each entry captures lengths, source path, and the
 * relevant guard inputs at the moment the transition happened.
 *
 * In-memory only — never persisted, never sent anywhere. 50-entry FIFO.
 *
 * The companion live-state guard `applyIncomingSummary` in
 * `training-summary-merge.ts` calls `recordSummaryTrace` for every
 * background-driven attempt to mutate Training summary state so we can tell
 * "blocked by guard" from "applied" without instrumenting the page.
 */

export type SummaryTraceSource =
  | 'idb-load'
  | 'server-refetch'
  | 'no-server-row'
  | 'backup-restore'
  | 'json-import'
  | 'editor-prop-reset'
  | 'placeholder-clobber-blocked'
  | 'finally-guard-deferred'
  | 'save-seq-stale-skip';

export type SummaryTraceField =
  | 'observations'
  | 'recommendations'
  | 'person_submitting'
  | 'submission_date'
  | 'row';

export interface SummaryTraceEntry {
  at: number;
  trainingId: string | null;
  field: SummaryTraceField;
  source: SummaryTraceSource;
  prevLen: number;
  nextLen: number;
  /** True when the incoming row carried an explicit field_timestamps entry strictly newer than local. */
  hadExplicitClear: boolean;
  /** Was the form dirty at trace time. */
  hasUnsaved: boolean;
  /** Was focus inside the Training Summary card at trace time. */
  focusInEditor: boolean;
  /** Save sequence number that produced this incoming, if known. */
  incomingSaveSeq: number | null;
  /** Current save sequence number. */
  currentSaveSeq: number | null;
  /** True when this trace records that the guard PREVENTED a mutation. */
  blocked: boolean;
}

const MAX_ENTRIES = 50;
const ring: SummaryTraceEntry[] = [];

export function recordSummaryTrace(entry: Omit<SummaryTraceEntry, 'at'>): void {
  const full: SummaryTraceEntry = { ...entry, at: Date.now() };
  ring.push(full);
  if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES);

  if (typeof console !== 'undefined') {
    // Metadata-only structured log; never includes report text.
    // eslint-disable-next-line no-console
    console.info('[TrainingSummaryTrace]', {
      trainingId: full.trainingId ? full.trainingId.substring(0, 8) : null,
      field: full.field,
      source: full.source,
      prevLen: full.prevLen,
      nextLen: full.nextLen,
      hadExplicitClear: full.hadExplicitClear,
      hasUnsaved: full.hasUnsaved,
      focusInEditor: full.focusInEditor,
      incomingSaveSeq: full.incomingSaveSeq,
      currentSaveSeq: full.currentSaveSeq,
      blocked: full.blocked,
    });
  }
}

export function getSummaryTraceEntries(): readonly SummaryTraceEntry[] {
  return ring.slice();
}

export function clearSummaryTraceEntries(): void {
  ring.length = 0;
}

/** Returns a small fingerprint string for a value without logging the value itself. */
export function fieldValueLength(value: unknown): number {
  if (typeof value !== 'string') return 0;
  return value.length;
}
