/**
 * Required-field gate for "Complete report" actions.
 *
 * Saving / autosave / IDB writes are intentionally NOT gated — drafts can be
 * empty and partial. Only the explicit Complete action is blocked when these
 * header fields are missing. The required set mirrors the existing zod schemas
 * (validation-schemas.ts, training-validation-schemas.ts,
 * daily-assessment-validation-schemas.ts) so we don't introduce new rules.
 *
 * See .lovable/plan.md and mem://features/required-field-completion-gate.
 */

export type MissingField = { key: string; label: string };

const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

type AnyRow = Record<string, unknown> | null | undefined;

export function getMissingInspectionFields(i: AnyRow): MissingField[] {
  const r = i ?? {};
  const out: MissingField[] = [];
  if (isBlank(r.organization)) out.push({ key: 'organization', label: 'Organization' });
  if (isBlank(r.location)) out.push({ key: 'location', label: 'Location' });
  if (isBlank(r.inspection_date)) out.push({ key: 'inspection_date', label: 'Inspection date' });
  return out;
}

export function getMissingTrainingFields(t: AnyRow): MissingField[] {
  const r = t ?? {};
  const out: MissingField[] = [];
  if (isBlank(r.organization)) out.push({ key: 'organization', label: 'Training site' });
  if (isBlank(r.start_date)) out.push({ key: 'start_date', label: 'Start date' });
  if (isBlank(r.end_date)) out.push({ key: 'end_date', label: 'End date' });
  return out;
}

export function getMissingAssessmentFields(a: AnyRow): MissingField[] {
  const r = a ?? {};
  const out: MissingField[] = [];
  if (isBlank(r.organization)) out.push({ key: 'organization', label: 'Organization' });
  if (isBlank(r.assessment_date)) out.push({ key: 'assessment_date', label: 'Assessment date' });
  return out;
}

export function formatMissingDescription(missing: MissingField[]): string {
  if (!missing.length) return '';
  return `Required fields missing: ${missing.map(m => m.label).join(', ')}`;
}
