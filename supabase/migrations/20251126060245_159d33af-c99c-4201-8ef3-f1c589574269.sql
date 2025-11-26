-- Add form type column to form_sections to distinguish between inspection, daily_assessment, and training forms
ALTER TABLE public.form_sections
ADD COLUMN form_type TEXT NOT NULL DEFAULT 'inspection';

-- Add index for form_type queries
CREATE INDEX idx_form_sections_form_type ON public.form_sections(form_type);

-- Update existing sections to be 'inspection' type (they already default to this)
UPDATE public.form_sections SET form_type = 'inspection';

-- ============================================
-- DAILY ASSESSMENT FORM CONFIGURATION
-- ============================================

-- Section 1: Beginning of Day
INSERT INTO public.form_sections (section_key, display_order, form_type) 
VALUES ('beginning_of_day', 1, 'daily_assessment');

-- Get the section_id for beginning_of_day
DO $$
DECLARE
  v_section_id UUID;
BEGIN
  SELECT id INTO v_section_id FROM public.form_sections 
  WHERE section_key = 'beginning_of_day' AND form_type = 'daily_assessment';

  -- Add fields for beginning of day checklist
  INSERT INTO public.form_fields (section_id, field_key, field_type, display_order, is_required) VALUES
  (v_section_id, 'first_aid_kit', 'checkbox', 1, false),
  (v_section_id, 'communication_protocol', 'checkbox', 2, false),
  (v_section_id, 'weather_plan', 'checkbox', 3, false),
  (v_section_id, 'emergency_procedures', 'checkbox', 4, false),
  (v_section_id, 'rescue_equipment', 'checkbox', 5, false),
  (v_section_id, 'staff_briefing', 'checkbox', 6, false);
END $$;

-- Section 2: End of Day
INSERT INTO public.form_sections (section_key, display_order, form_type) 
VALUES ('end_of_day', 2, 'daily_assessment');

DO $$
DECLARE
  v_section_id UUID;
BEGIN
  SELECT id INTO v_section_id FROM public.form_sections 
  WHERE section_key = 'end_of_day' AND form_type = 'daily_assessment';

  INSERT INTO public.form_fields (section_id, field_key, field_type, display_order, is_required) VALUES
  (v_section_id, 'equipment_secured', 'checkbox', 1, false),
  (v_section_id, 'area_cleaned', 'checkbox', 2, false),
  (v_section_id, 'documentation_complete', 'checkbox', 3, false),
  (v_section_id, 'incidents_reported', 'checkbox', 4, false),
  (v_section_id, 'equipment_maintenance', 'checkbox', 5, false),
  (v_section_id, 'tomorrow_preparation', 'checkbox', 6, false);
END $$;

-- Section 3: Equipment Checks
INSERT INTO public.form_sections (section_key, display_order, form_type) 
VALUES ('equipment_checks', 3, 'daily_assessment');

DO $$
DECLARE
  v_section_id UUID;
BEGIN
  SELECT id INTO v_section_id FROM public.form_sections 
  WHERE section_key = 'equipment_checks' AND form_type = 'daily_assessment';

  INSERT INTO public.form_fields (section_id, field_key, field_type, display_order, is_required) VALUES
  (v_section_id, 'harnesses_inspected', 'checkbox', 1, false),
  (v_section_id, 'carabiners_checked', 'checkbox', 2, false),
  (v_section_id, 'ropes_inspected', 'checkbox', 3, false),
  (v_section_id, 'helmets_checked', 'checkbox', 4, false),
  (v_section_id, 'pulleys_inspected', 'checkbox', 5, false),
  (v_section_id, 'trolleys_checked', 'checkbox', 6, false);
END $$;

-- Section 4: Structure Checks
INSERT INTO public.form_sections (section_key, display_order, form_type) 
VALUES ('structure_checks', 4, 'daily_assessment');

DO $$
DECLARE
  v_section_id UUID;
BEGIN
  SELECT id INTO v_section_id FROM public.form_sections 
  WHERE section_key = 'structure_checks' AND form_type = 'daily_assessment';

  INSERT INTO public.form_fields (section_id, field_key, field_type, display_order, is_required) VALUES
  (v_section_id, 'platforms_inspected', 'checkbox', 1, false),
  (v_section_id, 'cables_checked', 'checkbox', 2, false),
  (v_section_id, 'anchors_inspected', 'checkbox', 3, false),
  (v_section_id, 'posts_checked', 'checkbox', 4, false),
  (v_section_id, 'hardware_inspected', 'checkbox', 5, false),
  (v_section_id, 'signage_checked', 'checkbox', 6, false);
END $$;

-- Section 5: Environment Checks
INSERT INTO public.form_sections (section_key, display_order, form_type) 
VALUES ('environment_checks', 5, 'daily_assessment');

DO $$
DECLARE
  v_section_id UUID;
BEGIN
  SELECT id INTO v_section_id FROM public.form_sections 
  WHERE section_key = 'environment_checks' AND form_type = 'daily_assessment';

  INSERT INTO public.form_fields (section_id, field_key, field_type, display_order, is_required) VALUES
  (v_section_id, 'weather_acceptable', 'checkbox', 1, false),
  (v_section_id, 'visibility_adequate', 'checkbox', 2, false),
  (v_section_id, 'ground_conditions', 'checkbox', 3, false),
  (v_section_id, 'wildlife_concerns', 'checkbox', 4, false),
  (v_section_id, 'access_paths', 'checkbox', 5, false),
  (v_section_id, 'hazards_identified', 'checkbox', 6, false);
END $$;

-- Section 6: Operating Systems
INSERT INTO public.form_sections (section_key, display_order, form_type) 
VALUES ('operating_systems_daily', 6, 'daily_assessment');

DO $$
DECLARE
  v_section_id UUID;
BEGIN
  SELECT id INTO v_section_id FROM public.form_sections 
  WHERE section_key = 'operating_systems_daily' AND form_type = 'daily_assessment';

  INSERT INTO public.form_fields (section_id, field_key, field_type, display_order, is_required) VALUES
  (v_section_id, 'system_list', 'dynamic_list', 1, false);
END $$;

-- ============================================
-- TRAINING FORM CONFIGURATION
-- ============================================

-- Section 1: Delivery Approach
INSERT INTO public.form_sections (section_key, display_order, form_type) 
VALUES ('delivery_approach', 1, 'training');

DO $$
DECLARE
  v_section_id UUID;
  v_field_id UUID;
BEGIN
  SELECT id INTO v_section_id FROM public.form_sections 
  WHERE section_key = 'delivery_approach' AND form_type = 'training';

  INSERT INTO public.form_fields (section_id, field_key, field_type, display_order, is_required) 
  VALUES (v_section_id, 'approach_type', 'checkbox_multiple', 1, false)
  RETURNING id INTO v_field_id;

  -- Add options for delivery approach
  INSERT INTO public.form_field_options (field_id, option_key, display_order) VALUES
  (v_field_id, 'facilitated', 1),
  (v_field_id, 'guided', 2),
  (v_field_id, 'self_guided', 3);
END $$;

-- Section 2: Operating Systems
INSERT INTO public.form_sections (section_key, display_order, form_type) 
VALUES ('operating_systems_training', 2, 'training');

DO $$
DECLARE
  v_section_id UUID;
BEGIN
  SELECT id INTO v_section_id FROM public.form_sections 
  WHERE section_key = 'operating_systems_training' AND form_type = 'training';

  INSERT INTO public.form_fields (section_id, field_key, field_type, display_order, is_required) VALUES
  (v_section_id, 'system_list', 'dynamic_list', 1, false);
END $$;

-- Section 3: Systems in Place
INSERT INTO public.form_sections (section_key, display_order, form_type) 
VALUES ('systems_in_place', 3, 'training');

DO $$
DECLARE
  v_section_id UUID;
BEGIN
  SELECT id INTO v_section_id FROM public.form_sections 
  WHERE section_key = 'systems_in_place' AND form_type = 'training';

  INSERT INTO public.form_fields (section_id, field_key, field_type, display_order, is_required) VALUES
  (v_section_id, 'system_items', 'dynamic_list', 1, false);
END $$;

-- Section 4: Verifiable Items
INSERT INTO public.form_sections (section_key, display_order, form_type) 
VALUES ('verifiable_items', 4, 'training');

DO $$
DECLARE
  v_section_id UUID;
BEGIN
  SELECT id INTO v_section_id FROM public.form_sections 
  WHERE section_key = 'verifiable_items' AND form_type = 'training';

  INSERT INTO public.form_fields (section_id, field_key, field_type, display_order, is_required) VALUES
  (v_section_id, 'item_list', 'dynamic_list', 1, false);
END $$;

-- Section 5: Immediate Attention
INSERT INTO public.form_sections (section_key, display_order, form_type) 
VALUES ('immediate_attention', 5, 'training');

DO $$
DECLARE
  v_section_id UUID;
BEGIN
  SELECT id INTO v_section_id FROM public.form_sections 
  WHERE section_key = 'immediate_attention' AND form_type = 'training';

  INSERT INTO public.form_fields (section_id, field_key, field_type, display_order, is_required) VALUES
  (v_section_id, 'attention_items', 'dynamic_list', 1, false);
END $$;

-- Section 6: Summary
INSERT INTO public.form_sections (section_key, display_order, form_type) 
VALUES ('training_summary', 6, 'training');

DO $$
DECLARE
  v_section_id UUID;
BEGIN
  SELECT id INTO v_section_id FROM public.form_sections 
  WHERE section_key = 'training_summary' AND form_type = 'training';

  INSERT INTO public.form_fields (section_id, field_key, field_type, display_order, is_required) VALUES
  (v_section_id, 'observations', 'textarea', 1, false),
  (v_section_id, 'recommendations', 'textarea', 2, false),
  (v_section_id, 'person_submitting', 'text', 3, false),
  (v_section_id, 'submission_date', 'date', 4, false);
END $$;

-- ============================================
-- ADD TRANSLATIONS FOR ALL NEW FIELDS
-- ============================================

-- Daily Assessment Translations
INSERT INTO public.form_translations (entity_type, entity_id, language_code, translation_key, translation_value) 
SELECT 'section', id, 'en', 'label', 'Beginning of Day' FROM form_sections WHERE section_key = 'beginning_of_day' AND form_type = 'daily_assessment'
UNION ALL
SELECT 'section', id, 'en', 'label', 'End of Day' FROM form_sections WHERE section_key = 'end_of_day' AND form_type = 'daily_assessment'
UNION ALL
SELECT 'section', id, 'en', 'label', 'Equipment Checks' FROM form_sections WHERE section_key = 'equipment_checks' AND form_type = 'daily_assessment'
UNION ALL
SELECT 'section', id, 'en', 'label', 'Structure Checks' FROM form_sections WHERE section_key = 'structure_checks' AND form_type = 'daily_assessment'
UNION ALL
SELECT 'section', id, 'en', 'label', 'Environment Checks' FROM form_sections WHERE section_key = 'environment_checks' AND form_type = 'daily_assessment'
UNION ALL
SELECT 'section', id, 'en', 'label', 'Operating Systems' FROM form_sections WHERE section_key = 'operating_systems_daily' AND form_type = 'daily_assessment';

-- Training Translations
INSERT INTO public.form_translations (entity_type, entity_id, language_code, translation_key, translation_value) 
SELECT 'section', id, 'en', 'label', 'Delivery Approach' FROM form_sections WHERE section_key = 'delivery_approach' AND form_type = 'training'
UNION ALL
SELECT 'section', id, 'en', 'label', 'Operating Systems' FROM form_sections WHERE section_key = 'operating_systems_training' AND form_type = 'training'
UNION ALL
SELECT 'section', id, 'en', 'label', 'Systems in Place' FROM form_sections WHERE section_key = 'systems_in_place' AND form_type = 'training'
UNION ALL
SELECT 'section', id, 'en', 'label', 'Verifiable Items' FROM form_sections WHERE section_key = 'verifiable_items' AND form_type = 'training'
UNION ALL
SELECT 'section', id, 'en', 'label', 'Immediate Attention' FROM form_sections WHERE section_key = 'immediate_attention' AND form_type = 'training'
UNION ALL
SELECT 'section', id, 'en', 'label', 'Summary' FROM form_sections WHERE section_key = 'training_summary' AND form_type = 'training';

-- Field Translations for Daily Assessment - Beginning of Day
INSERT INTO public.form_translations (entity_type, entity_id, language_code, translation_key, translation_value)
SELECT 'field', f.id, 'en', 'label', 
  CASE f.field_key
    WHEN 'first_aid_kit' THEN 'First aid kit is accessible and equipped'
    WHEN 'communication_protocol' THEN 'Communication protocol is understood by all staff'
    WHEN 'weather_plan' THEN 'Weather plan has been reviewed for the day'
    WHEN 'emergency_procedures' THEN 'Emergency action procedures have been reviewed'
    WHEN 'rescue_equipment' THEN 'Rescue equipment is accessible and operational'
    WHEN 'staff_briefing' THEN 'Staff briefing completed including any concerns or changes'
  END
FROM public.form_fields f
JOIN public.form_sections s ON f.section_id = s.id
WHERE s.section_key = 'beginning_of_day' AND s.form_type = 'daily_assessment';

-- Field Translations for Daily Assessment - End of Day
INSERT INTO public.form_translations (entity_type, entity_id, language_code, translation_key, translation_value)
SELECT 'field', f.id, 'en', 'label',
  CASE f.field_key
    WHEN 'equipment_secured' THEN 'All equipment secured properly'
    WHEN 'area_cleaned' THEN 'Area cleaned and organized'
    WHEN 'documentation_complete' THEN 'Documentation completed'
    WHEN 'incidents_reported' THEN 'All incidents properly reported'
    WHEN 'equipment_maintenance' THEN 'Equipment needing maintenance identified'
    WHEN 'tomorrow_preparation' THEN 'Preparation for tomorrow completed'
  END
FROM public.form_fields f
JOIN public.form_sections s ON f.section_id = s.id
WHERE s.section_key = 'end_of_day' AND s.form_type = 'daily_assessment';

-- Field Translations for Daily Assessment - Equipment Checks
INSERT INTO public.form_translations (entity_type, entity_id, language_code, translation_key, translation_value)
SELECT 'field', f.id, 'en', 'label',
  CASE f.field_key
    WHEN 'harnesses_inspected' THEN 'Harnesses inspected'
    WHEN 'carabiners_checked' THEN 'Carabiners checked'
    WHEN 'ropes_inspected' THEN 'Ropes inspected'
    WHEN 'helmets_checked' THEN 'Helmets checked'
    WHEN 'pulleys_inspected' THEN 'Pulleys inspected'
    WHEN 'trolleys_checked' THEN 'Trolleys checked'
  END
FROM public.form_fields f
JOIN public.form_sections s ON f.section_id = s.id
WHERE s.section_key = 'equipment_checks' AND s.form_type = 'daily_assessment';

-- Field Translations for Daily Assessment - Structure Checks
INSERT INTO public.form_translations (entity_type, entity_id, language_code, translation_key, translation_value)
SELECT 'field', f.id, 'en', 'label',
  CASE f.field_key
    WHEN 'platforms_inspected' THEN 'Platforms inspected'
    WHEN 'cables_checked' THEN 'Cables checked'
    WHEN 'anchors_inspected' THEN 'Anchors inspected'
    WHEN 'posts_checked' THEN 'Posts checked'
    WHEN 'hardware_inspected' THEN 'Hardware inspected'
    WHEN 'signage_checked' THEN 'Signage checked'
  END
FROM public.form_fields f
JOIN public.form_sections s ON f.section_id = s.id
WHERE s.section_key = 'structure_checks' AND s.form_type = 'daily_assessment';

-- Field Translations for Daily Assessment - Environment Checks
INSERT INTO public.form_translations (entity_type, entity_id, language_code, translation_key, translation_value)
SELECT 'field', f.id, 'en', 'label',
  CASE f.field_key
    WHEN 'weather_acceptable' THEN 'Weather conditions acceptable'
    WHEN 'visibility_adequate' THEN 'Visibility adequate'
    WHEN 'ground_conditions' THEN 'Ground conditions safe'
    WHEN 'wildlife_concerns' THEN 'No wildlife concerns'
    WHEN 'access_paths' THEN 'Access paths clear'
    WHEN 'hazards_identified' THEN 'Hazards identified and mitigated'
  END
FROM public.form_fields f
JOIN public.form_sections s ON f.section_id = s.id
WHERE s.section_key = 'environment_checks' AND s.form_type = 'daily_assessment';

-- Field Translations for Training - Delivery Approach Options
INSERT INTO public.form_translations (entity_type, entity_id, language_code, translation_key, translation_value)
SELECT 'option', o.id, 'en', 'label',
  CASE o.option_key
    WHEN 'facilitated' THEN 'Facilitated'
    WHEN 'guided' THEN 'Guided'
    WHEN 'self_guided' THEN 'Self-Guided'
  END
FROM public.form_field_options o
JOIN public.form_fields f ON o.field_id = f.id
JOIN public.form_sections s ON f.section_id = s.id
WHERE s.section_key = 'delivery_approach' AND s.form_type = 'training';

-- Field Translations for Training - Summary Fields
INSERT INTO public.form_translations (entity_type, entity_id, language_code, translation_key, translation_value)
SELECT 'field', f.id, 'en', 'label',
  CASE f.field_key
    WHEN 'observations' THEN 'Observations'
    WHEN 'recommendations' THEN 'Recommendations'
    WHEN 'person_submitting' THEN 'Person Submitting'
    WHEN 'submission_date' THEN 'Submission Date'
  END
FROM public.form_fields f
JOIN public.form_sections s ON f.section_id = s.id
WHERE s.section_key = 'training_summary' AND s.form_type = 'training';

-- Add placeholders where needed
INSERT INTO public.form_translations (entity_type, entity_id, language_code, translation_key, translation_value)
SELECT 'field', f.id, 'en', 'placeholder',
  CASE f.field_key
    WHEN 'observations' THEN 'Enter your observations...'
    WHEN 'recommendations' THEN 'Enter your recommendations...'
    WHEN 'person_submitting' THEN 'Full name'
  END
FROM public.form_fields f
JOIN public.form_sections s ON f.section_id = s.id
WHERE s.section_key = 'training_summary' AND s.form_type = 'training'
  AND f.field_key IN ('observations', 'recommendations', 'person_submitting');