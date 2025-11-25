import { z } from 'zod';

// Training validation schema
export const trainingSchema = z.object({
  id: z.string().uuid(),
  organization: z.string().min(1, "Training site is required").max(255),
  start_date: z.string().min(1, "Start date is required"),
  end_date: z.string().min(1, "End date is required"),
  trainer_of_record: z.string().max(255).optional().nullable(),
  trainee_names: z.string().max(1000).optional().nullable(),
  status: z.enum(['draft', 'in_progress', 'completed']),
  inspector_id: z.string().uuid(),
  organization_id: z.string().uuid().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  synced_at: z.string().optional().nullable(),
});

// Delivery approach validation schema
export const deliveryApproachSchema = z.object({
  id: z.string().uuid(),
  training_id: z.string().uuid(),
  approach: z.enum(['Facilitated', 'Guided', 'Self-Guided']),
  created_at: z.string().optional(),
});

// Operating system validation schema
export const operatingSystemSchema = z.object({
  id: z.string().uuid(),
  training_id: z.string().uuid(),
  system_name: z.string().min(1),
  other_description: z.string().max(500).optional().nullable(),
  created_at: z.string().optional(),
});

// Immediate attention validation schema
export const immediateAttentionSchema = z.object({
  id: z.string().uuid(),
  training_id: z.string().uuid(),
  item: z.string().min(1),
  created_at: z.string().optional(),
});

// Verifiable items validation schema
export const verifiableItemSchema = z.object({
  id: z.string().uuid(),
  training_id: z.string().uuid(),
  item: z.string().min(1),
  created_at: z.string().optional(),
});

// Systems in place validation schema
export const systemInPlaceSchema = z.object({
  id: z.string().uuid(),
  training_id: z.string().uuid(),
  system_item: z.string().min(1),
  created_at: z.string().optional(),
});

// Training summary validation schema
export const trainingSummarySchema = z.object({
  id: z.string().uuid(),
  training_id: z.string().uuid(),
  observations: z.string().max(5000).optional().nullable(),
  recommendations: z.string().max(5000).optional().nullable(),
  person_submitting: z.string().max(255).optional().nullable(),
  submission_date: z.string().optional().nullable(),
  created_at: z.string().optional(),
});

// Complete training package validation
export const trainingPackageSchema = z.object({
  training: trainingSchema,
  delivery_approaches: z.array(deliveryApproachSchema),
  operating_systems: z.array(operatingSystemSchema),
  immediate_attention: z.array(immediateAttentionSchema),
  verifiable_items: z.array(verifiableItemSchema),
  systems_in_place: z.array(systemInPlaceSchema),
  summary: trainingSummarySchema.optional().nullable(),
});

// Validation helper functions
export function validateTrainingPackage(data: any) {
  try {
    const validated = trainingPackageSchema.parse(data);
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

export function validateTraining(data: any) {
  try {
    const validated = trainingSchema.parse(data);
    return { success: true, data: validated, errors: null };
  } catch (error: any) {
    return { success: false, data: null, errors: error.errors };
  }
}
