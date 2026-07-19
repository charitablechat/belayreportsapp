import { z } from 'zod';

// Ported from TAG: coerces inspector-entered "N/A"-like strings to the
// "0" sentinel that report renderers already display as an N/A pill.
// Empty strings become null so the field remains truly optional.
const productionYearPreprocess = (val: unknown): unknown => {
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  if (trimmed === '') return null;
  const upper = trimmed.toUpperCase();
  if (upper === 'N/A' || upper === 'NA' || upper === 'N.A.' ||
      upper === 'UNKNOWN' || upper === 'UNK') return '0';
  return trimmed;
};

// Accept both standard UUIDs and temp-prefixed UUIDs used before sync
const flexibleUUID = z.string().refine(
  (val) => {
    const raw = val.startsWith('temp-') ? val.slice(5) : val;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
  },
  { message: "Invalid identifier" }
);

// Inspection validation schema
export const inspectionSchema = z.object({
  id: z.string().uuid(),
  organization: z.string().min(1, "Organization is required").max(255),
  location: z.string().min(1, "Location is required").max(500).trim(),
  inspection_date: z.string().min(1, "Inspection date is required"),
  status: z.enum(['draft', 'in_progress', 'completed']),
  inspector_id: z.string().uuid(),
  organization_id: z.string().uuid().optional().nullable(),
  onsite_contact: z.string().max(255).optional().nullable(),
  course_history: z.string().max(5000).optional().nullable(),
  previous_inspector: z.string().max(255).optional().nullable(),
  previous_inspection_date: z.string().optional().nullable(),
  latitude: z.number().min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90").optional().nullable(),
  longitude: z.number().min(-180, "Longitude must be between -180 and 180").max(180, "Longitude must be between -180 and 180").optional().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  synced_at: z.string().optional().nullable(),
});

// System validation schema
export const systemSchema = z.object({
  id: flexibleUUID,
  inspection_id: flexibleUUID,
  system_name: z.string().optional().nullable(),
  result: z.enum(['pass', 'pass w/provisions', 'fail', 'na']).optional().nullable(),
  comments: z.string().max(2000).optional().nullable(),
  created_at: z.string().optional().nullable(),
  is_divider: z.boolean().optional().default(false),
  divider_text: z.string().optional().nullable(),
});

// Zipline validation schema
export const ziplineSchema = z.object({
  id: flexibleUUID,
  inspection_id: flexibleUUID,
  zipline_name: z.string().optional().nullable(),
  cable_type: z.string().optional().nullable(),
  cable_length: z.preprocess(
    (v) => (typeof v === 'number' && v <= 0 ? null : v),
    z.number().int().positive().optional().nullable()
  ),
  braking_system: z.string().optional().nullable(),
  ead_system: z.string().optional().nullable(),
  load_tension: z.number().int().optional().nullable(),
  unload_tension: z.number().int().optional().nullable(),
  result: z.enum(['pass', 'pass w/provisions', 'fail', 'na']).optional().nullable(),
  cable_result: z.enum(['pass', 'pass w/provisions', 'fail', 'na']).optional().nullable(),
  braking_result: z.enum(['pass', 'pass w/provisions', 'fail', 'na']).optional().nullable(),
  ead_result: z.enum(['pass', 'pass w/provisions', 'fail', 'na']).optional().nullable(),
  comments: z.string().max(2000).optional().nullable(),
  created_at: z.string().optional().nullable(),
});

// Equipment validation schema
export const equipmentSchema = z.object({
  id: flexibleUUID,
  inspection_id: flexibleUUID,
  equipment_type: z.string().optional().nullable(),
  equipment_category: z.string().optional().nullable(),
  production_year: z.preprocess(
    productionYearPreprocess,
    z.string().regex(/^(0|\d{4}(-\d{4})?)$/, "Must be a valid year (YYYY), year range (YYYY-YYYY), or N/A").optional().nullable()
  ),
  quantity: z.string().regex(/^\d+\+?$/, "Must be a number, optionally followed by +").optional().nullable(),
  result: z.enum(['pass', 'pass w/provisions', 'fail', 'na']).optional().nullable(),
  comments: z.string().max(2000).optional().nullable(),
  created_at: z.string().optional().nullable(),
});

// Standard validation schema
export const standardSchema = z.object({
  id: flexibleUUID,
  inspection_id: flexibleUUID,
  standard_name: z.string().optional().nullable(),
  has_documentation: z.boolean().nullable(), // Allow null for "Not Set" state
  comments: z.string().max(2000).optional().nullable(),
  created_at: z.string().optional().nullable(),
});

// Summary validation schema
export const summarySchema = z.object({
  id: flexibleUUID,
  inspection_id: flexibleUUID,
  repairs_performed: z.string().max(5000).optional().nullable(),
  critical_actions: z.string().max(5000).optional().nullable(),
  future_considerations: z.string().max(5000).optional().nullable(),
  next_inspection_date: z.string().optional().nullable(),
  created_at: z.string().optional().nullable(),
});

// Complete inspection package validation
export const inspectionPackageSchema = z.object({
  inspection: inspectionSchema,
  systems: z.array(systemSchema),
  ziplines: z.array(ziplineSchema),
  equipment: z.array(equipmentSchema),
  standards: z.array(standardSchema),
  summary: summarySchema.optional().nullable(),
});

// Validation helper functions
export function validateInspectionPackage(data: any) {
  try {
    const validated = inspectionPackageSchema.parse(data);
    return { success: true, data: validated, errors: null };
  } catch (error: any) {
    return { 
      success: false, 
      data: null, 
      errors: error.errors.map((e: any) => ({
        path: e.path.join('.'),
        message: e.message
      }))
    };
  }
}

export function validateInspection(data: any) {
  try {
    const validated = inspectionSchema.parse(data);
    return { success: true, data: validated, errors: null };
  } catch (error: any) {
    return { success: false, data: null, errors: error.errors };
  }
}
