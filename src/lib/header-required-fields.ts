/**
 * Shared "required header field" gate for the three report forms.
 *
 * Background
 * ----------
 * The sync engine validates the full parent record against a Zod schema
 * (`validateInspection`, `validateTraining`, `validateDailyAssessment`) just
 * before pushing to Supabase. The schemas require certain header fields —
 * notably `organization` for all three kinds — to be non-empty.
 *
 * The forms historically did NOT enforce that same invariant on the write
 * path. A user could clear a previously-good `organization` value, the clear
 * would be field-timestamped and persisted to IndexedDB, and every
 * subsequent sync attempt would fail forever with
 * `Validation failed: [{"path":"assessment.organization","message":"Organization is required"}]`
 * until someone re-typed the field on the original device.
 *
 * This module is the single source of truth the forms consult to mirror
 * the sync-time required-field invariants at save time so the two layers
 * cannot drift apart again. The forms render an inline banner whenever
 * `checkRequiredHeaderFields` reports a missing field, and the user-
 * initiated save path blocks until the missing fields are filled in.
 */

export type ReportKind = 'inspection' | 'training' | 'daily_assessment';

export interface RequiredField {
  /** Property name on the IDB record (must match the Zod schema field). */
  readonly field: string;
  /** Human-readable label shown in inline error banners + toasts. */
  readonly label: string;
}

/**
 * Required header fields per report kind. These MUST be kept in lock-step
 * with the `z.string().min(1, "<...> is required")` constraints in
 * `validation-schemas.ts`, `training-validation-schemas.ts`, and
 * `daily-assessment-validation-schemas.ts` respectively. The companion
 * test `header-required-fields.test.ts` asserts the two stay aligned.
 */
export const REQUIRED_HEADER_FIELDS: Record<ReportKind, readonly RequiredField[]> = {
  inspection: [
    { field: 'organization', label: 'Organization' },
    { field: 'location', label: 'Location' },
    { field: 'inspection_date', label: 'Inspection Date' },
  ],
  training: [
    { field: 'organization', label: 'Training Site' },
    { field: 'start_date', label: 'Start Date' },
    { field: 'end_date', label: 'End Date' },
  ],
  daily_assessment: [
    { field: 'organization', label: 'Organization' },
    { field: 'assessment_date', label: 'Assessment Date' },
  ],
};

export interface RequiredFieldsCheck {
  /** True when every required header field has a non-empty value. */
  readonly ok: boolean;
  /** The fields (with labels) that are currently missing/empty. */
  readonly missing: readonly RequiredField[];
}

/**
 * Returns true when `value` is null, undefined, or a string that contains
 * no non-whitespace characters. Anything else (numbers, booleans,
 * non-empty strings) counts as present.
 */
function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}

/**
 * Check `record` against the required-header-fields list for `kind`. Safe
 * to call with `null`/`undefined` records — those are treated as missing
 * every required field (e.g. the form is still loading).
 */
export function checkRequiredHeaderFields(
  record: Record<string, unknown> | null | undefined,
  kind: ReportKind,
): RequiredFieldsCheck {
  const required = REQUIRED_HEADER_FIELDS[kind];
  if (record == null) {
    return { ok: false, missing: required };
  }
  const missing: RequiredField[] = [];
  for (const entry of required) {
    if (isMissing(record[entry.field])) {
      missing.push(entry);
    }
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Format the missing-field list for inline display, e.g. "Organization,
 * Location". Returns an empty string when nothing is missing. Used by the
 * form banner + toast copy so both surfaces stay in lock-step.
 */
export function formatMissingFieldLabels(missing: readonly RequiredField[]): string {
  return missing.map((m) => m.label).join(', ');
}
