/**
 * Pure decision helper extracted from TrainingForm's Generate-Report flow.
 *
 * Two pieces of context together decide whether the cached `latest_report_html`
 * stored on `trainings` is safe to serve without re-running generation:
 *
 *   1. The cached row must actually exist (latest_report_generated_at and
 *      updated_at both populated). When the
 *      `invalidate_training_report_cache_on_photo` trigger fires (insert,
 *      update, or delete on `training_photos`), it nulls both
 *      `latest_report_generated_at` and `latest_report_html`, so the cache
 *      check naturally short-circuits.
 *   2. The form must have no pending unsaved edits. Mirrors the safer
 *      InspectionForm pattern: a trainer who just typed into Observations or
 *      uploaded a photo has not yet rolled those edits into the DB row's
 *      `updated_at`, so `generatedAt >= updatedAt` would lie and serve a
 *      stale cached HTML.
 *
 * Keeping this as a tiny pure function lets vitest pin the contract without
 * mounting TrainingForm.
 */
export interface TrainingReportCacheInput {
  latestReportGeneratedAt: string | null | undefined;
  trainingUpdatedAt: string | null | undefined;
  hasUnsavedChanges: boolean;
}

export function shouldUseCachedTrainingReport(
  input: TrainingReportCacheInput,
): boolean {
  if (input.hasUnsavedChanges) return false;
  if (!input.latestReportGeneratedAt) return false;
  if (!input.trainingUpdatedAt) return false;
  const generatedAt = new Date(input.latestReportGeneratedAt).getTime();
  const updatedAt = new Date(input.trainingUpdatedAt).getTime();
  if (Number.isNaN(generatedAt) || Number.isNaN(updatedAt)) return false;
  return generatedAt >= updatedAt;
}
