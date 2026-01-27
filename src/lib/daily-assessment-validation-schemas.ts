import { z } from 'zod';

// Daily Assessment validation schema
export const dailyAssessmentSchema = z.object({
  id: z.string().uuid(),
  organization: z.string().min(1, "Organization is required").max(255),
  site: z.string().max(255).default(''),
  assessment_date: z.string().min(1, "Assessment date is required"),
  trainer_of_record: z.string().max(255).optional().nullable(),
  status: z.enum(['draft', 'in_progress', 'completed']),
  inspector_id: z.string().uuid(),
  organization_id: z.string().uuid().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  synced_at: z.string().optional().nullable(),
  last_opened_at: z.string().optional().nullable(),
  // Section comments fields
  environment_comments: z.string().max(5000).optional().nullable(),
  structure_comments: z.string().max(5000).optional().nullable(),
  systems_comments: z.string().max(5000).optional().nullable(),
});

// Beginning of day validation schema
export const beginningOfDaySchema = z.object({
  id: z.string().uuid(),
  assessment_id: z.string().uuid(),
  item_key: z.string().min(1),
  is_complete: z.boolean().default(false),
  comments: z.string().max(2000).optional().nullable(),
  created_at: z.string().optional(),
});

// End of day validation schema
export const endOfDaySchema = z.object({
  id: z.string().uuid(),
  assessment_id: z.string().uuid(),
  item_key: z.string().min(1),
  is_complete: z.boolean().default(false),
  comments: z.string().max(2000).optional().nullable(),
  created_at: z.string().optional(),
});

// Assessment operating system validation schema
export const assessmentOperatingSystemSchema = z.object({
  id: z.string().uuid(),
  assessment_id: z.string().uuid(),
  system_name: z.string().min(1),
  other_description: z.string().max(500).optional().nullable(),
  created_at: z.string().optional(),
});

// Equipment check validation schema
export const equipmentCheckSchema = z.object({
  id: z.string().uuid(),
  assessment_id: z.string().uuid(),
  item_key: z.string().min(1),
  is_checked: z.boolean().default(false),
  comments: z.string().max(2000).optional().nullable(),
  created_at: z.string().optional(),
});

// Structure check validation schema
export const structureCheckSchema = z.object({
  id: z.string().uuid(),
  assessment_id: z.string().uuid(),
  item_key: z.string().min(1),
  is_checked: z.boolean().default(false),
  comments: z.string().max(2000).optional().nullable(),
  created_at: z.string().optional(),
});

// Environment check validation schema
export const environmentCheckSchema = z.object({
  id: z.string().uuid(),
  assessment_id: z.string().uuid(),
  item_key: z.string().min(1),
  is_checked: z.boolean().default(false),
  comments: z.string().max(2000).optional().nullable(),
  created_at: z.string().optional(),
});

// Complete daily assessment package validation
export const dailyAssessmentPackageSchema = z.object({
  assessment: dailyAssessmentSchema,
  beginning_of_day: z.array(beginningOfDaySchema),
  end_of_day: z.array(endOfDaySchema),
  operating_systems: z.array(assessmentOperatingSystemSchema),
  equipment_checks: z.array(equipmentCheckSchema),
  structure_checks: z.array(structureCheckSchema),
  environment_checks: z.array(environmentCheckSchema),
});

// Validation helper functions
export function validateDailyAssessmentPackage(data: any) {
  try {
    const validated = dailyAssessmentPackageSchema.parse(data);
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

export function validateDailyAssessment(data: any) {
  try {
    const validated = dailyAssessmentSchema.parse(data);
    return { success: true, data: validated, errors: null };
  } catch (error: any) {
    return { success: false, data: null, errors: error.errors };
  }
}
