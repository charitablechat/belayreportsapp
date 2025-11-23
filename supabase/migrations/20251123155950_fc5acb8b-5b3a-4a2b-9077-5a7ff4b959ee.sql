-- Create form field configuration tables for CMS

-- Table for form sections (e.g., "Systems", "Ziplines", "Equipment", "Standards", "Summary")
CREATE TABLE IF NOT EXISTS public.form_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key TEXT NOT NULL UNIQUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table for form fields within sections
CREATE TABLE IF NOT EXISTS public.form_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES public.form_sections(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  field_type TEXT NOT NULL, -- 'text', 'textarea', 'select', 'number', 'date', 'checkbox', 'radio'
  display_order INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  validation_rules JSONB, -- Store validation rules like min, max, pattern, etc.
  metadata JSONB, -- Additional field metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(section_id, field_key)
);

-- Table for field options (for select, radio, checkbox fields)
CREATE TABLE IF NOT EXISTS public.form_field_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id UUID NOT NULL REFERENCES public.form_fields(id) ON DELETE CASCADE,
  option_key TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table for translations (supports multiple languages)
CREATE TABLE IF NOT EXISTS public.form_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL, -- 'section', 'field', 'option', 'label', 'help_text'
  entity_id UUID NOT NULL, -- References id from form_sections, form_fields, or form_field_options
  language_code TEXT NOT NULL DEFAULT 'en',
  translation_key TEXT NOT NULL, -- 'label', 'placeholder', 'help_text', 'error_message', etc.
  translation_value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(entity_type, entity_id, language_code, translation_key)
);

-- Table for form configuration versions (audit trail)
CREATE TABLE IF NOT EXISTS public.form_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_number INTEGER NOT NULL,
  configuration JSONB NOT NULL, -- Complete snapshot of form configuration
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  notes TEXT
);

-- Enable RLS on all tables
ALTER TABLE public.form_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_field_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_versions ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Everyone can read (for form rendering), only super admins can modify

-- form_sections policies
CREATE POLICY "Anyone can view active form sections"
  ON public.form_sections FOR SELECT
  USING (true);

CREATE POLICY "Super admins can manage form sections"
  ON public.form_sections FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- form_fields policies
CREATE POLICY "Anyone can view active form fields"
  ON public.form_fields FOR SELECT
  USING (true);

CREATE POLICY "Super admins can manage form fields"
  ON public.form_fields FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- form_field_options policies
CREATE POLICY "Anyone can view active field options"
  ON public.form_field_options FOR SELECT
  USING (true);

CREATE POLICY "Super admins can manage field options"
  ON public.form_field_options FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- form_translations policies
CREATE POLICY "Anyone can view translations"
  ON public.form_translations FOR SELECT
  USING (true);

CREATE POLICY "Super admins can manage translations"
  ON public.form_translations FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- form_versions policies
CREATE POLICY "Super admins can view form versions"
  ON public.form_versions FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can create form versions"
  ON public.form_versions FOR INSERT
  WITH CHECK (is_super_admin());

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_form_fields_section_id ON public.form_fields(section_id);
CREATE INDEX IF NOT EXISTS idx_form_field_options_field_id ON public.form_field_options(field_id);
CREATE INDEX IF NOT EXISTS idx_form_translations_entity ON public.form_translations(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_form_translations_language ON public.form_translations(language_code);

-- Create triggers for updated_at
CREATE TRIGGER update_form_sections_updated_at
  BEFORE UPDATE ON public.form_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_form_fields_updated_at
  BEFORE UPDATE ON public.form_fields
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_form_field_options_updated_at
  BEFORE UPDATE ON public.form_field_options
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_form_translations_updated_at
  BEFORE UPDATE ON public.form_translations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Insert default form configuration based on existing inspection form structure
-- This migrates the current hardcoded fields to the CMS

-- Insert sections
INSERT INTO public.form_sections (section_key, display_order, is_active) VALUES
  ('basic_info', 0, true),
  ('systems', 1, true),
  ('ziplines', 2, true),
  ('equipment', 3, true),
  ('standards', 4, true),
  ('summary', 5, true);

-- Insert basic info fields
INSERT INTO public.form_fields (section_id, field_key, field_type, display_order, is_required)
SELECT id, 'organization', 'text', 0, true FROM public.form_sections WHERE section_key = 'basic_info'
UNION ALL
SELECT id, 'location', 'text', 1, true FROM public.form_sections WHERE section_key = 'basic_info'
UNION ALL
SELECT id, 'inspection_date', 'date', 2, true FROM public.form_sections WHERE section_key = 'basic_info'
UNION ALL
SELECT id, 'course_history', 'textarea', 3, false FROM public.form_sections WHERE section_key = 'basic_info'
UNION ALL
SELECT id, 'previous_inspection_date', 'date', 4, false FROM public.form_sections WHERE section_key = 'basic_info'
UNION ALL
SELECT id, 'previous_inspector', 'text', 5, false FROM public.form_sections WHERE section_key = 'basic_info'
UNION ALL
SELECT id, 'onsite_contact', 'text', 6, false FROM public.form_sections WHERE section_key = 'basic_info';

-- Insert system fields
INSERT INTO public.form_fields (section_id, field_key, field_type, display_order, is_required)
SELECT id, 'system_name', 'text', 0, true FROM public.form_sections WHERE section_key = 'systems'
UNION ALL
SELECT id, 'result', 'select', 1, true FROM public.form_sections WHERE section_key = 'systems'
UNION ALL
SELECT id, 'comments', 'textarea', 2, false FROM public.form_sections WHERE section_key = 'systems';

-- Insert result options for systems
INSERT INTO public.form_field_options (field_id, option_key, display_order)
SELECT f.id, 'pass', 0 FROM public.form_fields f 
JOIN public.form_sections s ON f.section_id = s.id 
WHERE s.section_key = 'systems' AND f.field_key = 'result'
UNION ALL
SELECT f.id, 'fail', 1 FROM public.form_fields f 
JOIN public.form_sections s ON f.section_id = s.id 
WHERE s.section_key = 'systems' AND f.field_key = 'result'
UNION ALL
SELECT f.id, 'needs_attention', 2 FROM public.form_fields f 
JOIN public.form_sections s ON f.section_id = s.id 
WHERE s.section_key = 'systems' AND f.field_key = 'result';

-- Insert equipment fields
INSERT INTO public.form_fields (section_id, field_key, field_type, display_order, is_required)
SELECT id, 'equipment_category', 'select', 0, true FROM public.form_sections WHERE section_key = 'equipment'
UNION ALL
SELECT id, 'equipment_type', 'text', 1, true FROM public.form_sections WHERE section_key = 'equipment'
UNION ALL
SELECT id, 'quantity', 'number', 2, false FROM public.form_sections WHERE section_key = 'equipment'
UNION ALL
SELECT id, 'production_year', 'number', 3, false FROM public.form_sections WHERE section_key = 'equipment'
UNION ALL
SELECT id, 'result', 'select', 4, true FROM public.form_sections WHERE section_key = 'equipment'
UNION ALL
SELECT id, 'comments', 'textarea', 5, false FROM public.form_sections WHERE section_key = 'equipment';

-- Insert English translations for sections
INSERT INTO public.form_translations (entity_type, entity_id, language_code, translation_key, translation_value)
SELECT 'section', id, 'en', 'label', 
  CASE section_key
    WHEN 'basic_info' THEN 'Basic Information'
    WHEN 'systems' THEN 'Operating Systems'
    WHEN 'ziplines' THEN 'Ziplines'
    WHEN 'equipment' THEN 'Equipment'
    WHEN 'standards' THEN 'Standards'
    WHEN 'summary' THEN 'Summary'
  END
FROM public.form_sections;

-- Insert English translations for basic info fields
INSERT INTO public.form_translations (entity_type, entity_id, language_code, translation_key, translation_value)
SELECT 'field', f.id, 'en', 'label',
  CASE f.field_key
    WHEN 'organization' THEN 'Organization'
    WHEN 'location' THEN 'Location'
    WHEN 'inspection_date' THEN 'Inspection Date'
    WHEN 'course_history' THEN 'Course History'
    WHEN 'previous_inspection_date' THEN 'Previous Inspection Date'
    WHEN 'previous_inspector' THEN 'Previous Inspector'
    WHEN 'onsite_contact' THEN 'Onsite Contact'
    WHEN 'system_name' THEN 'System Name'
    WHEN 'equipment_category' THEN 'Category'
    WHEN 'equipment_type' THEN 'Equipment Type'
    WHEN 'quantity' THEN 'Quantity'
    WHEN 'production_year' THEN 'Production Year'
    WHEN 'result' THEN 'Result'
    WHEN 'comments' THEN 'Comments'
  END
FROM public.form_fields f;

-- Insert English translations for result options
INSERT INTO public.form_translations (entity_type, entity_id, language_code, translation_key, translation_value)
SELECT 'option', o.id, 'en', 'label',
  CASE o.option_key
    WHEN 'pass' THEN 'Pass'
    WHEN 'fail' THEN 'Fail'
    WHEN 'needs_attention' THEN 'Needs Attention'
  END
FROM public.form_field_options o;

-- Create initial version snapshot
INSERT INTO public.form_versions (version_number, configuration, notes)
VALUES (
  1,
  jsonb_build_object(
    'sections', (SELECT jsonb_agg(row_to_json(s.*)) FROM public.form_sections s),
    'fields', (SELECT jsonb_agg(row_to_json(f.*)) FROM public.form_fields f),
    'options', (SELECT jsonb_agg(row_to_json(o.*)) FROM public.form_field_options o),
    'translations', (SELECT jsonb_agg(row_to_json(t.*)) FROM public.form_translations t)
  ),
  'Initial migration from hardcoded form configuration'
);