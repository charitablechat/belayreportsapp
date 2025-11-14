import { z } from 'zod';

// Inspection validation schema
export const inspectionSchema = z.object({
  id: z.string().uuid(),
  organization: z.string().min(1, "Organization is required"),
  location: z.string().min(1, "Location is required"),
  inspection_date: z.string().min(1, "Inspection date is required"),
  status: z.enum(['draft', 'in_progress', 'completed']),
  inspector_id: z.string().uuid(),
  organization_id: z.string().uuid().optional().nullable(),
  onsite_contact: z.string().optional().nullable(),
  course_history: z.string().optional().nullable(),
  previous_inspector: z.string().optional().nullable(),
  previous_inspection_date: z.string().optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  synced_at: z.string().optional().nullable(),
});

// System validation schema
export const systemSchema = z.object({
  id: z.string().uuid(),
  inspection_id: z.string().uuid(),
  system_name: z.string().optional().nullable(),
  result: z.enum(['pass', 'pass w/provisions', 'pass w/ repair', 'fail', 'na']),
  comments: z.string().optional().nullable(),
  created_at: z.string().optional(),
});

// Zipline validation schema
export const ziplineSchema = z.object({
  id: z.string().uuid(),
  inspection_id: z.string().uuid(),
  zipline_name: z.string().optional().nullable(),
  cable_type: z.string().optional().nullable(),
  cable_length: z.number().int().positive().optional().nullable(),
  braking_system: z.string().optional().nullable(),
  ead_system: z.string().optional().nullable(),
  load_tension: z.number().int().optional().nullable(),
  unload_tension: z.number().int().optional().nullable(),
  result: z.enum(['pass', 'pass w/provisions', 'pass w/ repair', 'fail', 'na']),
  cable_result: z.enum(['pass', 'pass w/provisions', 'pass w/ repair', 'fail', 'na']).optional().nullable(),
  braking_result: z.enum(['pass', 'pass w/provisions', 'pass w/ repair', 'fail', 'na']).optional().nullable(),
  ead_result: z.enum(['pass', 'pass w/provisions', 'pass w/ repair', 'fail', 'na']).optional().nullable(),
  comments: z.string().optional().nullable(),
  created_at: z.string().optional(),
});

// Equipment validation schema
export const equipmentSchema = z.object({
  id: z.string().uuid(),
  inspection_id: z.string().uuid(),
  equipment_type: z.string().optional().nullable(),
  equipment_category: z.string().optional().nullable(),
  production_year: z.number().int().min(1900).max(2100).optional().nullable(),
  quantity: z.number().int().positive().optional().nullable(),
  result: z.enum(['pass', 'pass w/provisions', 'pass w/ repair', 'fail', 'na']),
  comments: z.string().optional().nullable(),
  created_at: z.string().optional(),
});

// Standard validation schema
export const standardSchema = z.object({
  id: z.string().uuid(),
  inspection_id: z.string().uuid(),
  standard_name: z.string().optional().nullable(),
  has_documentation: z.boolean(),
  comments: z.string().optional().nullable(),
  created_at: z.string().optional(),
});

// Summary validation schema
export const summarySchema = z.object({
  id: z.string().uuid(),
  inspection_id: z.string().uuid(),
  repairs_performed: z.string().optional().nullable(),
  critical_actions: z.string().optional().nullable(),
  future_considerations: z.string().optional().nullable(),
  next_inspection_date: z.string().optional().nullable(),
  created_at: z.string().optional(),
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
