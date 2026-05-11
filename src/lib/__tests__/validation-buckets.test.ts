import { describe, expect, it, vi } from 'vitest';
import {
  bucketValidationFailures,
  getValidationStuckRecords,
} from '@/lib/validation-buckets';
import { validateInspection } from '@/lib/validation-schemas';
import { validateTraining } from '@/lib/training-validation-schemas';
import { validateDailyAssessment } from '@/lib/daily-assessment-validation-schemas';

vi.mock('@/lib/offline-storage', () => ({
  getUnsyncedInspections: vi.fn(async () => []),
  getUnsyncedTrainings: vi.fn(async () => []),
  getUnsyncedDailyAssessments: vi.fn(async () => []),
}));

/**
 * Stub validator that always succeeds. Used to scope a test to a single
 * report kind without leaking failures from the other two.
 */
const okValidator = () => ({ success: true as const, errors: null });

/**
 * Stub validator that always fails with a single root-level issue on
 * the supplied `field` path. Sufficient to exercise the bucket emitter
 * without booting the real Zod schemas.
 */
const failOn = (field: string) => () => ({
  success: false as const,
  errors: [{ path: [field], message: `${field} is required` }],
});

describe('bucketValidationFailures', () => {
  it('returns count=0 and an empty record list when every parent validates', () => {
    const result = bucketValidationFailures(
      [{ id: 'i-1', organization: 'X' }],
      [{ id: 't-1', organization: 'Y' }],
      [{ id: 'a-1', organization: 'Z' }],
      {
        inspection: okValidator,
        training: okValidator,
        daily_assessment: okValidator,
      },
    );
    expect(result.count).toBe(0);
    expect(result.records).toEqual([]);
  });

  it('emits a stuck record for every failing parent and labels it with organization', () => {
    const result = bucketValidationFailures(
      [{ id: 'i-1', organization: 'AcmeCo' }],
      [{ id: 't-1', organization: 'AcmeCo' }],
      [{ id: 'a-1', organization: 'AcmeCo' }],
      {
        inspection: failOn('organization'),
        training: failOn('start_date'),
        daily_assessment: failOn('organization'),
      },
    );

    expect(result.count).toBe(3);
    expect(result.records).toEqual([
      {
        id: 'i-1',
        kind: 'inspection',
        label: 'AcmeCo',
        missingFields: ['organization'],
        deepLinkPath: '/inspection/i-1',
      },
      {
        id: 't-1',
        kind: 'training',
        label: 'AcmeCo',
        missingFields: ['start_date'],
        deepLinkPath: '/training/t-1',
      },
      {
        id: 'a-1',
        kind: 'daily_assessment',
        label: 'AcmeCo',
        missingFields: ['organization'],
        deepLinkPath: '/daily-assessment/a-1',
      },
    ]);
  });

  it('de-duplicates and sorts missingFields when multiple issues touch the same path', () => {
    const result = bucketValidationFailures(
      [],
      [],
      [{ id: 'a-1', organization: 'AcmeCo' }],
      {
        inspection: okValidator,
        training: okValidator,
        daily_assessment: () => ({
          success: false,
          errors: [
            { path: ['organization'], message: 'Organization is required' },
            { path: ['organization'], message: 'Organization is required' },
            { path: ['assessment_date'], message: 'Assessment date is required' },
          ],
        }),
      },
    );

    expect(result.records).toHaveLength(1);
    expect(result.records[0].missingFields).toEqual(['assessment_date', 'organization']);
  });

  it('falls back to site → location → course_title → kind-specific placeholder for label', () => {
    const result = bucketValidationFailures(
      [{ id: 'i-1', location: 'Bay 4' }],
      [{ id: 't-1', course_title: 'Intro to Rope Access' }],
      [{ id: 'a-1', site: 'East Tower' }, { id: 'a-2' }],
      {
        inspection: failOn('organization'),
        training: failOn('organization'),
        daily_assessment: failOn('organization'),
      },
    );

    expect(result.records.map((r) => r.label)).toEqual([
      'Bay 4',
      'Intro to Rope Access',
      'East Tower',
      'Untitled Assessment',
    ]);
  });

  it('treats empty-string organization as falsy so labelFor falls through to site/location', () => {
    // Regression lock for Devin Review finding: the primary scenario
    // this surface targets is a record stranded with `organization: ''`.
    // Using `??` (only null/undefined falls through) would short-circuit
    // and skip the still-present `site` value, producing 'Untitled
    // Assessment' instead of 'East Tower'.
    const result = bucketValidationFailures(
      [],
      [],
      [
        { id: 'a-1', organization: '', site: 'East Tower' },
        { id: 'a-2', organization: '   ', location: 'Bay 4' },
      ],
      {
        inspection: okValidator,
        training: okValidator,
        daily_assessment: failOn('organization'),
      },
    );

    expect(result.records.map((r) => r.label)).toEqual(['East Tower', 'Bay 4']);
  });

  it('ignores records with missing id (cannot be deep-linked)', () => {
    const result = bucketValidationFailures(
      [{ organization: 'AcmeCo' }, { id: 'i-1', organization: 'AcmeCo' }],
      [],
      [],
      {
        inspection: failOn('organization'),
        training: okValidator,
        daily_assessment: okValidator,
      },
    );

    expect(result.count).toBe(1);
    expect(result.records[0]?.id).toBe('i-1');
  });

  it('preserves stable inspection → training → assessment ordering', () => {
    const result = bucketValidationFailures(
      [{ id: 'i-1' }, { id: 'i-2' }],
      [{ id: 't-1' }],
      [{ id: 'a-1' }, { id: 'a-2' }, { id: 'a-3' }],
      {
        inspection: failOn('organization'),
        training: failOn('organization'),
        daily_assessment: failOn('organization'),
      },
    );

    expect(result.records.map((r) => r.kind)).toEqual([
      'inspection',
      'inspection',
      'training',
      'daily_assessment',
      'daily_assessment',
      'daily_assessment',
    ]);
  });

  it('treats validator-success records as passing even when they look thin (no organization)', () => {
    const result = bucketValidationFailures(
      [],
      [],
      [{ id: 'a-1' }],
      {
        inspection: okValidator,
        training: okValidator,
        daily_assessment: okValidator,
      },
    );
    expect(result.count).toBe(0);
  });
});

describe('getValidationStuckRecords userId guard', () => {
  it('returns EMPTY without hitting IDB when userId is null/undefined/empty', async () => {
    const storage = await import('@/lib/offline-storage');
    const inspectionsMock = vi.mocked(storage.getUnsyncedInspections);
    const trainingsMock = vi.mocked(storage.getUnsyncedTrainings);
    const assessmentsMock = vi.mocked(storage.getUnsyncedDailyAssessments);
    inspectionsMock.mockClear();
    trainingsMock.mockClear();
    assessmentsMock.mockClear();

    for (const userId of [null, undefined, '']) {
      const result = await getValidationStuckRecords(userId);
      expect(result).toEqual({ count: 0, records: [] });
    }

    // Regression lock for the Devin Review finding: when no userId is
    // available we must NEVER call the IDB readers without a filter,
    // since they short-circuit ownership when userId is omitted and
    // would surface records from every account on the device.
    expect(inspectionsMock).not.toHaveBeenCalled();
    expect(trainingsMock).not.toHaveBeenCalled();
    expect(assessmentsMock).not.toHaveBeenCalled();
  });

  it('forwards the userId to every IDB reader', async () => {
    const storage = await import('@/lib/offline-storage');
    const inspectionsMock = vi.mocked(storage.getUnsyncedInspections);
    const trainingsMock = vi.mocked(storage.getUnsyncedTrainings);
    const assessmentsMock = vi.mocked(storage.getUnsyncedDailyAssessments);
    inspectionsMock.mockClear();
    trainingsMock.mockClear();
    assessmentsMock.mockClear();

    await getValidationStuckRecords('user-abc');

    expect(inspectionsMock).toHaveBeenCalledWith('user-abc');
    expect(trainingsMock).toHaveBeenCalledWith('user-abc');
    expect(assessmentsMock).toHaveBeenCalledWith('user-abc');
  });
});

/**
 * Integration check against the real schemas — guards the bucket
 * builder against drift in the actual `validate*` helpers. We construct
 * synthetic records with empty `organization` (the field that triggered
 * the original Sentry alert on Android Chrome) and assert all three
 * production validators classify them as stuck.
 */
describe('bucketValidationFailures against the real Zod validators', () => {
  it('flags every report kind whose organization is empty as stuck', () => {
    const result = bucketValidationFailures(
      [
        {
          id: 'i-1',
          organization: '',
          location: 'Bay 4',
        },
      ],
      [
        {
          id: 't-1',
          organization: '',
          course_title: 'Intro',
        },
      ],
      [
        {
          id: 'a-1',
          organization: '',
          site: 'East Tower',
        },
      ],
      {
        inspection: validateInspection,
        training: validateTraining,
        daily_assessment: validateDailyAssessment,
      },
    );

    expect(result.count).toBe(3);
    for (const record of result.records) {
      expect(record.missingFields).toContain('organization');
    }
  });
});
