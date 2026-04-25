/**
 * Shared utility functions for report data access and emptiness checks.
 */

/** Opaque structural row type shared across child tables. */
type Row = Record<string, unknown>;

/** Partial report shape used across all three report types. Each function below
 * reads a narrow subset of fields; structural typing lets callers pass whichever
 * shape they already have in hand without `any`. */
type ReportLike = Record<string, unknown> & {
  trainer?: { first_name?: string | null; last_name?: string | null } | null;
  inspector?: { first_name?: string | null; last_name?: string | null } | null;
  training?: { start_date?: string | null } | null;
};

/** Helper: does an unknown value look like a non-empty trimmed string? */
function hasTrimmed(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

/** Helper: typed row-field read returning unknown (narrowed at call site). */
function field(row: Row | undefined | null, key: string): unknown {
  return row ? row[key] : undefined;
}

/**
 * Get the primary date for a report based on its type.
 * Unified fallback chain used by both filters and list views.
 */
export function getReportDate(report: ReportLike, type: string): string {
  if (type === 'inspection') {
    const d = report.inspection_date;
    return typeof d === 'string' ? d : '';
  }
  if (type === 'daily') {
    const d = report.assessment_date;
    return typeof d === 'string' ? d : '';
  }
  const trainingStart = report.training?.start_date;
  if (typeof trainingStart === 'string' && trainingStart) return trainingStart;
  if (typeof report.start_date === 'string' && report.start_date) return report.start_date;
  if (typeof report.created_at === 'string' && report.created_at) return report.created_at;
  return '';
}

/**
 * Get the assignee/inspector/trainer display name for a report.
 */
export interface ProfileLike {
  first_name?: string | null;
  last_name?: string | null;
}

export function getAssigneeName(
  report: ReportLike,
  type: string,
  profilesById?: ReadonlyMap<string, ProfileLike> | null,
): string {
  const join = type === 'training' ? (report as any).trainer : (report as any).inspector;
  const fromJoin = join
    ? `${join.first_name || ''} ${join.last_name || ''}`.trim()
    : '';
  if (fromJoin) return fromJoin;

  const inspectorId = (report as any).inspector_id as string | undefined;
  if (profilesById && typeof inspectorId === 'string') {
    const p = profilesById.get(inspectorId);
    if (p) {
      const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      if (name) return name;
    }
  }
  return 'Unknown';
}

/**
 * Utility functions for checking if reports have meaningful content.
 * Used to prevent saving/displaying empty reports on the dashboard.
 */

/**
 * Check if an inspection has any meaningful user-entered data
 */
export function isInspectionEmpty(
  inspection: Row | null | undefined,
  systems: Row[] = [],
  ziplines: Row[] = [],
  equipment: Row[] = [],
  standards: Row[] = [],
  summary: Row | null = null,
): boolean {
  if (!inspection) return true;

  // Check if any systems have meaningful data
  const hasSystemData = systems.some(s =>
    hasTrimmed(s.name) || hasTrimmed(s.comments) || s.result !== 'pass'
  );

  // Check if any ziplines have meaningful data
  const hasZiplineData = ziplines.some(z =>
    hasTrimmed(z.zipline_name) || hasTrimmed(z.comments) ||
    hasTrimmed(z.cable_type) || hasTrimmed(z.braking_system) || hasTrimmed(z.ead_system) ||
    z.result !== 'pass'
  );

  // Check if any equipment has meaningful data
  const hasEquipmentData = equipment.some(e =>
    hasTrimmed(e.equipment_type) || hasTrimmed(e.comments) || e.result !== 'pass'
  );

  // Check if any standards have been marked as having documentation
  const hasStandardData = standards.some(s =>
    s.has_documentation === true || hasTrimmed(s.comments)
  );

  // Check if summary has meaningful data
  const hasSummaryData = !!summary && (
    hasTrimmed(field(summary, 'repairs_performed')) ||
    hasTrimmed(field(summary, 'critical_actions')) ||
    hasTrimmed(field(summary, 'future_considerations')) ||
    !!field(summary, 'next_inspection_date')
  );

  // Check if header has any meaningful data beyond defaults
  const hasHeaderData =
    hasTrimmed(inspection.onsite_contact) ||
    hasTrimmed(inspection.course_history) ||
    hasTrimmed(inspection.acct_number);

  return !hasSystemData && !hasZiplineData && !hasEquipmentData &&
         !hasStandardData && !hasSummaryData && !hasHeaderData;
}

/**
 * Check if a training report has any meaningful user-entered data
 */
export function isTrainingEmpty(
  training: Row | null | undefined,
  deliveryApproaches: Row[] = [],
  operatingSystems: Row[] = [],
  immediateAttention: Row[] = [],
  verifiableItems: Row[] = [],
  systemsInPlace: Row[] = [],
  summary: Row | null = null,
): boolean {
  if (!training) return true;

  // Check for any selected items in lists
  const hasDeliveryApproaches = deliveryApproaches.length > 0;
  const hasOperatingSystems = operatingSystems.length > 0;
  const hasImmediateAttention = immediateAttention.length > 0;
  const hasVerifiableItems = verifiableItems.length > 0;
  const hasSystemsInPlace = systemsInPlace.length > 0;

  // Check if summary has meaningful data
  const hasSummaryData = !!summary && (
    hasTrimmed(field(summary, 'observations')) ||
    hasTrimmed(field(summary, 'recommendations'))
  );

  // Check if header has meaningful data beyond defaults
  const hasHeaderData = hasTrimmed(training.trainee_names);

  return !hasDeliveryApproaches && !hasOperatingSystems &&
         !hasImmediateAttention && !hasVerifiableItems &&
         !hasSystemsInPlace && !hasSummaryData && !hasHeaderData;
}

/**
 * Check if a daily assessment has any meaningful user-entered data
 */
export function isDailyAssessmentEmpty(
  assessment: Row | null | undefined,
  beginningOfDay: Row[] = [],
  endOfDay: Row[] = [],
  environmentChecks: Row[] = [],
  equipmentChecks: Row[] = [],
  structureChecks: Row[] = [],
  operatingSystems: Row[] = [],
): boolean {
  if (!assessment) return true;

  // Check if any beginning of day items are completed or have comments
  const hasBeginningData = beginningOfDay.some(b =>
    b.is_complete === true || hasTrimmed(b.comments)
  );

  // Check if any end of day items are completed or have comments
  const hasEndOfDayData = endOfDay.some(e =>
    e.is_complete === true || hasTrimmed(e.comments)
  );

  // Check if any environment checks are completed or have comments
  const hasEnvironmentData = environmentChecks.some(e =>
    e.is_checked === true || hasTrimmed(e.comments)
  );

  // Check if any equipment checks are completed or have comments
  const hasEquipmentData = equipmentChecks.some(e =>
    e.is_checked === true || hasTrimmed(e.comments)
  );

  // Check if any structure checks are completed or have comments
  const hasStructureData = structureChecks.some(s =>
    s.is_checked === true || hasTrimmed(s.comments)
  );

  // Check if any operating systems are selected
  const hasOperatingSystemsData = operatingSystems.length > 0;

  return !hasBeginningData && !hasEndOfDayData && !hasEnvironmentData &&
         !hasEquipmentData && !hasStructureData && !hasOperatingSystemsData;
}

/**
 * Check if a report should be deleted when user navigates away
 * Returns true if the report is a draft with no meaningful content
 */
export function shouldDeleteEmptyReport(
  status: string | undefined,
  isEmpty: boolean
): boolean {
  return status === 'draft' && isEmpty;
}
