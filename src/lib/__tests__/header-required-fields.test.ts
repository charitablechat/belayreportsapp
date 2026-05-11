/**
 * Regression lock for the shared "required header field" gate.
 *
 * Purpose
 * -------
 * The forms (DailyAssessment, Inspection, Training) consult
 * `checkRequiredHeaderFields` to mirror the sync-time required-field
 * invariants encoded in the Zod schemas. If a new required field is
 * added to a Zod schema without a matching entry in
 * `REQUIRED_HEADER_FIELDS`, the form will let the user save a record
 * that can never sync — exactly the bug that produced the production
 * Sentry "Validation failed: assessment.organization is required"
 * event on Android Chrome.
 *
 * These tests bind the contract on both sides:
 *  - The helper itself behaves correctly on the obvious edge cases
 *    (null/undefined record, empty string, whitespace-only string,
 *    non-empty value, present-but-not-required field).
 *  - Every entry in `REQUIRED_HEADER_FIELDS` corresponds to an actual
 *    `z.string().min(1, "<...> is required")` field in the matching
 *    schema. Drift between this list and the schemas fails CI here.
 */

import { describe, it, expect } from 'vitest';
import {
  REQUIRED_HEADER_FIELDS,
  checkRequiredHeaderFields,
  formatMissingFieldLabels,
  type ReportKind,
} from '@/lib/header-required-fields';
import { inspectionSchema } from '@/lib/validation-schemas';
import { trainingSchema } from '@/lib/training-validation-schemas';
import { dailyAssessmentSchema } from '@/lib/daily-assessment-validation-schemas';

/**
 * Build a minimum-valid record for each kind. Tests then mutate one
 * field at a time to verify the helper catches the missing value.
 */
function minimumValidRecord(kind: ReportKind): Record<string, unknown> {
  const base = {
    id: '00000000-0000-0000-0000-000000000001',
    inspector_id: '00000000-0000-0000-0000-000000000002',
    status: 'draft' as const,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  if (kind === 'inspection') {
    return {
      ...base,
      organization: 'Camp ABC',
      location: 'North Field',
      inspection_date: '2026-01-01',
    };
  }
  if (kind === 'training') {
    return {
      ...base,
      organization: 'Camp ABC',
      start_date: '2026-01-01',
      end_date: '2026-01-02',
    };
  }
  return {
    ...base,
    organization: 'Camp ABC',
    site: '',
    assessment_date: '2026-01-01',
  };
}

describe('checkRequiredHeaderFields — basic contract', () => {
  it('returns ok=true when every required field has a non-empty value', () => {
    for (const kind of ['inspection', 'training', 'daily_assessment'] as ReportKind[]) {
      const result = checkRequiredHeaderFields(minimumValidRecord(kind), kind);
      expect(result.ok, `kind=${kind}`).toBe(true);
      expect(result.missing).toEqual([]);
    }
  });

  it('returns ok=false when the record is null or undefined', () => {
    for (const kind of ['inspection', 'training', 'daily_assessment'] as ReportKind[]) {
      const nullResult = checkRequiredHeaderFields(null, kind);
      const undefResult = checkRequiredHeaderFields(undefined, kind);
      expect(nullResult.ok).toBe(false);
      expect(undefResult.ok).toBe(false);
      expect(nullResult.missing.length).toBe(REQUIRED_HEADER_FIELDS[kind].length);
      expect(undefResult.missing.length).toBe(REQUIRED_HEADER_FIELDS[kind].length);
    }
  });

  it('treats empty string as missing', () => {
    const record = { ...minimumValidRecord('daily_assessment'), organization: '' };
    const result = checkRequiredHeaderFields(record, 'daily_assessment');
    expect(result.ok).toBe(false);
    expect(result.missing.map((m) => m.field)).toContain('organization');
  });

  it('treats whitespace-only string as missing', () => {
    const record = { ...minimumValidRecord('inspection'), organization: '   \t  ' };
    const result = checkRequiredHeaderFields(record, 'inspection');
    expect(result.ok).toBe(false);
    expect(result.missing.map((m) => m.field)).toContain('organization');
  });

  it('treats null and undefined values as missing', () => {
    const nullRecord = { ...minimumValidRecord('training'), organization: null };
    const undefRecord = { ...minimumValidRecord('training'), organization: undefined };
    expect(checkRequiredHeaderFields(nullRecord, 'training').ok).toBe(false);
    expect(checkRequiredHeaderFields(undefRecord, 'training').ok).toBe(false);
  });

  it('reports every missing required field, not just the first', () => {
    const record = {
      ...minimumValidRecord('inspection'),
      organization: '',
      location: '',
    };
    const result = checkRequiredHeaderFields(record, 'inspection');
    expect(result.ok).toBe(false);
    const missingFields = result.missing.map((m) => m.field).sort();
    expect(missingFields).toEqual(['location', 'organization']);
  });

  it('ignores fields not in the required-fields registry', () => {
    const record = {
      ...minimumValidRecord('daily_assessment'),
      site: '', // site has .default('') in the schema — not required
      trainer_of_record: null, // optional
    };
    const result = checkRequiredHeaderFields(record, 'daily_assessment');
    expect(result.ok).toBe(true);
  });

  it('returns the same RequiredField objects from the registry (label is preserved)', () => {
    const record = { ...minimumValidRecord('inspection'), organization: '' };
    const result = checkRequiredHeaderFields(record, 'inspection');
    const orgEntry = result.missing.find((m) => m.field === 'organization');
    expect(orgEntry).toBeDefined();
    expect(orgEntry?.label).toBe('Organization');
  });
});

describe('formatMissingFieldLabels', () => {
  it('returns empty string when nothing is missing', () => {
    expect(formatMissingFieldLabels([])).toBe('');
  });

  it('joins labels with commas in registry order', () => {
    const result = checkRequiredHeaderFields(
      { ...minimumValidRecord('inspection'), organization: '', location: '' },
      'inspection',
    );
    expect(formatMissingFieldLabels(result.missing)).toBe('Organization, Location');
  });
});

describe('REQUIRED_HEADER_FIELDS — schema alignment', () => {
  /**
   * Drift detector: if a Zod schema has a `z.string().min(1, "...")`
   * required header field that is NOT listed in REQUIRED_HEADER_FIELDS,
   * the form will let users save unsyncable records. These tests prove
   * that for every entry in REQUIRED_HEADER_FIELDS the matching schema
   * rejects an empty string at that path, AND that emptying that field
   * is enough on its own to fail validation.
   */

  const matrix: { kind: ReportKind; schema: any; baseline: Record<string, unknown> }[] = [
    { kind: 'inspection', schema: inspectionSchema, baseline: minimumValidRecord('inspection') },
    { kind: 'training', schema: trainingSchema, baseline: minimumValidRecord('training') },
    { kind: 'daily_assessment', schema: dailyAssessmentSchema, baseline: minimumValidRecord('daily_assessment') },
  ];

  for (const { kind, schema, baseline } of matrix) {
    it(`every REQUIRED_HEADER_FIELDS[${kind}] entry corresponds to a min(1) schema rule`, () => {
      // Baseline must validate cleanly first — otherwise the per-field
      // assertions below are meaningless.
      const baselineResult = schema.safeParse(baseline);
      expect(baselineResult.success, `baseline must parse cleanly for ${kind}: ${
        baselineResult.success ? '' : JSON.stringify(baselineResult.error?.errors)
      }`).toBe(true);

      for (const { field } of REQUIRED_HEADER_FIELDS[kind]) {
        const broken = { ...baseline, [field]: '' };
        const result = schema.safeParse(broken);
        expect(
          result.success,
          `expected schema for ${kind} to reject empty ${field}, but it parsed cleanly`,
        ).toBe(false);
        if (!result.success) {
          const hasFieldError = result.error.errors.some((e) => e.path[0] === field);
          expect(hasFieldError, `expected error at path '${field}' for ${kind}`).toBe(true);
        }
      }
    });
  }
});
