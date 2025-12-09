/**
 * Utility functions for checking if reports have meaningful content.
 * Used to prevent saving/displaying empty reports on the dashboard.
 */

/**
 * Check if an inspection has any meaningful user-entered data
 */
export function isInspectionEmpty(
  inspection: any,
  systems: any[] = [],
  ziplines: any[] = [],
  equipment: any[] = [],
  standards: any[] = [],
  summary: any = null
): boolean {
  if (!inspection) return true;

  // Check if any systems have meaningful data
  const hasSystemData = systems.some(s => 
    s.name?.trim() || s.comments?.trim() || s.result !== 'pass'
  );

  // Check if any ziplines have meaningful data
  const hasZiplineData = ziplines.some(z =>
    z.zipline_name?.trim() || z.comments?.trim() || 
    z.cable_type?.trim() || z.braking_system?.trim() || z.ead_system?.trim() ||
    z.result !== 'pass'
  );

  // Check if any equipment has meaningful data
  const hasEquipmentData = equipment.some(e =>
    e.equipment_type?.trim() || e.comments?.trim() || e.result !== 'pass'
  );

  // Check if any standards have been marked as having documentation
  const hasStandardData = standards.some(s => s.has_documentation === true || s.comments?.trim());

  // Check if summary has meaningful data
  const hasSummaryData = summary && (
    summary.repairs_performed?.trim() ||
    summary.critical_actions?.trim() ||
    summary.future_considerations?.trim() ||
    summary.next_inspection_date
  );

  // Check if header has any meaningful data beyond defaults
  const hasHeaderData = inspection.onsite_contact?.trim() ||
    inspection.course_history?.trim() ||
    inspection.acct_number?.trim();

  return !hasSystemData && !hasZiplineData && !hasEquipmentData && 
         !hasStandardData && !hasSummaryData && !hasHeaderData;
}

/**
 * Check if a training report has any meaningful user-entered data
 */
export function isTrainingEmpty(
  training: any,
  deliveryApproaches: any[] = [],
  operatingSystems: any[] = [],
  immediateAttention: any[] = [],
  verifiableItems: any[] = [],
  systemsInPlace: any[] = [],
  summary: any = null
): boolean {
  if (!training) return true;

  // Check for any selected items in lists
  const hasDeliveryApproaches = deliveryApproaches.length > 0;
  const hasOperatingSystems = operatingSystems.length > 0;
  const hasImmediateAttention = immediateAttention.length > 0;
  const hasVerifiableItems = verifiableItems.length > 0;
  const hasSystemsInPlace = systemsInPlace.length > 0;

  // Check if summary has meaningful data
  const hasSummaryData = summary && (
    summary.observations?.trim() ||
    summary.recommendations?.trim()
  );

  // Check if header has meaningful data beyond defaults
  const hasHeaderData = training.trainee_names?.trim();

  return !hasDeliveryApproaches && !hasOperatingSystems && 
         !hasImmediateAttention && !hasVerifiableItems && 
         !hasSystemsInPlace && !hasSummaryData && !hasHeaderData;
}

/**
 * Check if a daily assessment has any meaningful user-entered data
 */
export function isDailyAssessmentEmpty(
  assessment: any,
  beginningOfDay: any[] = [],
  endOfDay: any[] = [],
  environmentChecks: any[] = [],
  equipmentChecks: any[] = [],
  structureChecks: any[] = [],
  operatingSystems: any[] = []
): boolean {
  if (!assessment) return true;

  // Check if any beginning of day items are completed or have comments
  const hasBeginningData = beginningOfDay.some(b => 
    b.is_complete === true || b.comments?.trim()
  );

  // Check if any end of day items are completed or have comments
  const hasEndOfDayData = endOfDay.some(e => 
    e.is_complete === true || e.comments?.trim()
  );

  // Check if any environment checks are completed or have comments
  const hasEnvironmentData = environmentChecks.some(e => 
    e.is_checked === true || e.comments?.trim()
  );

  // Check if any equipment checks are completed or have comments
  const hasEquipmentData = equipmentChecks.some(e => 
    e.is_checked === true || e.comments?.trim()
  );

  // Check if any structure checks are completed or have comments
  const hasStructureData = structureChecks.some(s => 
    s.is_checked === true || s.comments?.trim()
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
