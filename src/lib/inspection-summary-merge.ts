/**
 * Helpers for Inspection Summary load/merge decisions in InspectionForm.tsx.
 *
 * Mirrors `src/lib/training-summary-merge.ts` for the four user-editable
 * `inspection_summary` columns: `repairs_performed`, `critical_actions`,
 * `future_considerations`, `next_inspection_date`.
 *
 * Why this exists: prior to this module, `InspectionForm.loadInspection`
 * blindly called `setSummary(serverData)` whenever the server returned an
 * `inspection_summary` row. A stale Realtime self-write, admin-viewer
 * refetch, or interrupted-then-resumed save could surface a row where the
 * user's just-typed text was missing — and `setSummary` then wiped the
 * local React state AND wrote that empty row to IDB. The user's text
 * disappeared on the next reload.
 *
 * Strict preservation rule (stricter than the training helper, per the
 * "explicit clear must be truly explicit" clarification):
 *
 *   For a tracked field, an empty incoming value can ONLY overwrite a
 *   non-empty local value when the incoming row carries an EXPLICIT
 *   per-field timestamp (`incoming.field_timestamps[field]`) that is
 *   strictly newer than the local per-field timestamp for the same
 *   field. A newer row-level `updated_at` alone is NOT sufficient
 *   evidence of an intentional clear — that timestamp could come from
 *   any unrelated background write.
 *
 * The form is responsible for stamping `field_timestamps[field]` on
 * every user edit (including user-initiated clears) so cross-device
 * intentional clears propagate while background empties cannot.
 */
import { mergeRecordFields } from '@/lib/field-merge';

export const INSPECTION_SUMMARY_FIELDS = [
  'repairs_performed',
  'critical_actions',
  'future_considerations',
  'next_inspection_date',
] as const;

export type InspectionSummaryField = (typeof INSPECTION_SUMMARY_FIELDS)[number];

type Row = Record<string, unknown> | null | undefined;

export function inspectionSummaryFieldTimestampMs(row: Row, field: string): number {
  const explicit = (row?.field_timestamps as Record<string, string> | null | undefined)?.[field];
  const updated = typeof row?.updated_at === 'string' ? (row.updated_at as string) : null;
  const raw = explicit || updated;
  const ms = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

/** True if neither the local React state nor IDB row has any user content yet. */
export function isEmptyPlaceholderInspectionSummary(row: Row): boolean {
  if (!row) return true;
  const hasRepairs = typeof row.repairs_performed === 'string' && !isRichTextMissing(row.repairs_performed as string);
  const hasCritical = typeof row.critical_actions === 'string' && !isRichTextMissing(row.critical_actions as string);
  const hasFuture = typeof row.future_considerations === 'string' && !isRichTextMissing(row.future_considerations as string);
  const hasDate = !!row.next_inspection_date;
  const ts = (row.field_timestamps as Record<string, string> | null | undefined) ?? null;
  const hasTimestamps = !!ts && Object.keys(ts).length > 0;
  return !hasRepairs && !hasCritical && !hasFuture && !hasDate && !hasTimestamps;
}

/** TipTap emits `<p></p>` and `<br />` shells when a rich-text editor is cleared. */
function isRichTextMissing(value: string): boolean {
  const stripped = value.replace(/<p><\/p>/g, '').replace(/<br\s*\/?>/g, '').trim();
  return stripped.length === 0;
}

export function isFieldMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return isRichTextMissing(value);
  return false;
}

type MergeableSummaryRow = Record<string, unknown> & {
  updated_at?: string | null;
  field_timestamps?: Record<string, string> | null;
};

interface PreventedWipe {
  field: string;
  prevLen: number;
  nextLen: number;
}

export interface MergeResult<T> {
  merged: T;
  /** Fields where a non-empty local value was preserved against an empty incoming. */
  preserved: PreventedWipe[];
  /** Fields where an explicit cross-device clear was honoured. */
  honouredClears: PreventedWipe[];
}

/**
 * Field-level merge for `inspection_summary` with strict empty-preservation.
 *
 * Behaviour per tracked field:
 *
 *   1. Run `mergeRecordFields` over the four tracked fields (per-field LWW).
 *   2. If the merged value is missing and local was populated:
 *        a. If incoming has an EXPLICIT `field_timestamps[field]` that is
 *           strictly newer than local's per-field stamp → treat as a
 *           cross-device intentional clear; keep merged value empty and
 *           record `honouredClears`.
 *        b. Otherwise → restore the local non-empty value and record
 *           `preserved` (this is the bug-fix path).
 *   3. If the merged value is missing and incoming was populated (LWW
 *      chose an empty local) → restore the incoming value. (Defensive;
 *      `mergeRecordFields` should not produce this, but be safe.)
 */
export function mergeInspectionSummaryPreservingPopulated<T extends MergeableSummaryRow>(
  local: T,
  incoming: T,
): MergeResult<T> {
  const merged = mergeRecordFields(local, incoming, [...INSPECTION_SUMMARY_FIELDS]) as T;

  const mergedTimestamps: Record<string, string> = {
    ...((merged.field_timestamps as Record<string, string> | null) ?? {}),
  };
  const preserved: PreventedWipe[] = [];
  const honouredClears: PreventedWipe[] = [];
  let touched = false;

  for (const field of INSPECTION_SUMMARY_FIELDS) {
    const mergedValue = (merged as Record<string, unknown>)[field];
    const localValue = (local as Record<string, unknown>)[field];
    const incomingValue = (incoming as Record<string, unknown>)[field];

    if (!isFieldMissing(mergedValue)) continue;

    const localPopulated = !isFieldMissing(localValue);
    const incomingPopulated = !isFieldMissing(incomingValue);

    if (!localPopulated && !incomingPopulated) continue;

    if (incomingPopulated && !localPopulated) {
      // LWW chose an empty local over a populated incoming — restore incoming.
      const ts = incoming.field_timestamps?.[field];
      (merged as Record<string, unknown>)[field] = incomingValue;
      if (ts) mergedTimestamps[field] = ts;
      touched = true;
      continue;
    }

    // localPopulated && (incoming empty or also populated-but-lost-LWW)
    const localExplicit = local.field_timestamps?.[field];
    const incomingExplicit = incoming.field_timestamps?.[field];

    // STRICT explicit-clear gate: an empty incoming can only clear a
    // populated local if incoming carries an explicit per-field timestamp
    // strictly newer than local's explicit per-field timestamp. Row-level
    // updated_at is intentionally NOT considered here — a fresh updated_at
    // from a background row save would otherwise look like a "newer clear".
    const incomingMs = incomingExplicit ? Date.parse(incomingExplicit) : NaN;
    const localMs = localExplicit ? Date.parse(localExplicit) : NaN;

    const incomingFieldEmpty = isFieldMissing(incomingValue);
    const isExplicitCrossDeviceClear =
      incomingFieldEmpty &&
      !!incomingExplicit &&
      Number.isFinite(incomingMs) &&
      (!Number.isFinite(localMs) || incomingMs > localMs);

    const prevLen = lengthOf(localValue);

    if (isExplicitCrossDeviceClear) {
      honouredClears.push({ field, prevLen, nextLen: 0 });
      // Leave merged empty; stamp the clear timestamp so future merges agree.
      mergedTimestamps[field] = incomingExplicit!;
      touched = true;
      continue;
    }

    // Preserve local non-empty value.
    (merged as Record<string, unknown>)[field] = localValue;
    if (localExplicit) mergedTimestamps[field] = localExplicit;
    preserved.push({ field, prevLen, nextLen: lengthOf(mergedValue) });
    touched = true;
  }

  if (touched) {
    merged.field_timestamps = mergedTimestamps;
  }

  if (preserved.length > 0 || honouredClears.length > 0) {
    void recordSummaryTransition({
      reportType: 'inspection',
      reportId: (local.id ?? local.inspection_id ?? incoming.id ?? incoming.inspection_id ?? null) as string | null,
      source: 'load-merge',
      preserved,
      honouredClears,
    });
  }

  return { merged, preserved, honouredClears };
}

function lengthOf(value: unknown): number {
  if (typeof value !== 'string') return value == null ? 0 : 1;
  return value.replace(/<[^>]+>/g, '').trim().length;
}

export interface SummaryTransitionBreadcrumb {
  reportType: 'inspection' | 'training' | 'daily_assessment';
  reportId: string | null;
  source: 'load-merge' | 'autosave' | 'submit' | 'sync-replay' | 'admin-edit' | 'hydration';
  preserved: PreventedWipe[];
  honouredClears: PreventedWipe[];
}

/**
 * Non-PII Sentry breadcrumb for summary transitions. Records metadata only:
 * report type, report id, field names, value lengths, source path. NEVER
 * records the actual summary text. Safe in any environment — wraps Sentry
 * in dynamic-import + try/catch so it cannot break the save path.
 */
export async function recordSummaryTransition(crumb: SummaryTransitionBreadcrumb): Promise<void> {
  try {
    if (typeof window === 'undefined') return;
    const Sentry = await import('@sentry/react').catch(() => null);
    if (!Sentry || typeof Sentry.addBreadcrumb !== 'function') return;
    Sentry.addBreadcrumb({
      category: 'summary-preservation',
      level: 'info',
      message: `summary-merge ${crumb.reportType}`,
      data: {
        reportType: crumb.reportType,
        reportId: crumb.reportId,
        source: crumb.source,
        preserved: crumb.preserved,
        honouredClears: crumb.honouredClears,
      },
    });
  } catch {
    // Breadcrumbs are best-effort.
  }
}
