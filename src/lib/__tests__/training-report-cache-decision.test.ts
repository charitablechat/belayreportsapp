/**
 * Pins the contract for the Training Generate-Report cache decision.
 *
 * Three regression locks, mirroring the user-facing fix scope:
 *
 *  1. `hasUnsavedChanges === true` MUST suppress the cache, regardless of
 *     timestamp ordering. Parity with InspectionForm.
 *
 *  2. When the `invalidate_training_report_cache_on_photo` DB trigger has
 *     fired (insert/update/delete on `training_photos`), the parent
 *     `trainings.latest_report_generated_at` is nulled. The decision helper
 *     MUST then refuse the cache so the next Generate Report regenerates
 *     with the new photo set.
 *
 *  3. The legitimate clean-cache hit still works: no unsaved changes,
 *     generatedAt >= updatedAt, cached row populated.
 */
import { describe, it, expect } from 'vitest';
import { shouldUseCachedTrainingReport } from '../training-report-cache-decision';

describe('shouldUseCachedTrainingReport', () => {
  const generated = '2026-05-22T05:00:00.000Z';
  const olderUpdated = '2026-05-22T04:00:00.000Z';
  const newerUpdated = '2026-05-22T06:00:00.000Z';

  it('refuses cache while unsaved changes are pending (admin/owner just typed)', () => {
    expect(
      shouldUseCachedTrainingReport({
        latestReportGeneratedAt: generated,
        trainingUpdatedAt: olderUpdated,
        hasUnsavedChanges: true,
      }),
    ).toBe(false);
  });

  it('refuses cache after a photo write nulled latest_report_generated_at (trigger fired)', () => {
    expect(
      shouldUseCachedTrainingReport({
        latestReportGeneratedAt: null,
        trainingUpdatedAt: olderUpdated,
        hasUnsavedChanges: false,
      }),
    ).toBe(false);
  });

  it('refuses cache when the row was modified after the last generation', () => {
    expect(
      shouldUseCachedTrainingReport({
        latestReportGeneratedAt: generated,
        trainingUpdatedAt: newerUpdated,
        hasUnsavedChanges: false,
      }),
    ).toBe(false);
  });

  it('serves cached HTML on a clean read with no in-flight edits', () => {
    expect(
      shouldUseCachedTrainingReport({
        latestReportGeneratedAt: generated,
        trainingUpdatedAt: olderUpdated,
        hasUnsavedChanges: false,
      }),
    ).toBe(true);
  });

  it('refuses cache when timestamps are malformed', () => {
    expect(
      shouldUseCachedTrainingReport({
        latestReportGeneratedAt: 'not-a-date',
        trainingUpdatedAt: olderUpdated,
        hasUnsavedChanges: false,
      }),
    ).toBe(false);
  });
});
