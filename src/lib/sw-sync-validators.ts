/**
 * Pure validation functions extracted from public/sw-sync.js
 * These mirror the exact logic in the service worker so they can be unit-tested
 * in a vitest environment without service worker globals.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate inspection package before sync.
 * Mirrors validateInspectionData() in sw-sync.js exactly.
 */
export function validateInspectionData(
  inspection: { id: string | null; organization: string; location: string },
  systems: Array<{ system_name?: string; result?: string }>,
  ziplines: Array<{ zipline_name?: string; result?: string }>,
  equipment: Array<{ equipment_type?: string; equipment_category?: string; result?: string }>,
  standards: Array<{ standard_name?: string; has_documentation?: boolean }>,
  _summary: any
): ValidationResult {
  const errors: string[] = [];

  // Validate inspection
  if (!inspection.id || !inspection.organization || !inspection.location) {
    errors.push('Inspection missing required fields');
  }

  // Validate systems
  systems.forEach((s, i) => {
    if (!s.system_name || !s.result) {
      errors.push(`System ${i + 1} missing required fields`);
    }
  });

  // Validate ziplines
  ziplines.forEach((z, i) => {
    if (!z.zipline_name || !z.result) {
      errors.push(`Zipline ${i + 1} missing required fields`);
    }
  });

  // Validate equipment
  equipment.forEach((e, i) => {
    if (!e.equipment_type || !e.equipment_category || !e.result) {
      errors.push(`Equipment ${i + 1} missing required fields`);
    }
  });

  // Validate standards
  standards.forEach((s, i) => {
    if (!s.standard_name || typeof s.has_documentation !== 'boolean') {
      errors.push(`Standard ${i + 1} missing required fields`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Guard check for upsert operations.
 * Mirrors the guard at the top of upsertRelatedData() in sw-sync.js.
 * Returns true if the data should be skipped (null or empty array).
 */
export function shouldSkipUpsert(data: any[] | null | undefined): boolean {
  return !data || data.length === 0;
}
