-- Create daily_assessments table
CREATE TABLE public.daily_assessments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inspector_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assessment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  site TEXT NOT NULL DEFAULT '',
  trainer_of_record TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  organization TEXT NOT NULL DEFAULT '',
  organization_id UUID REFERENCES public.organizations(id),
  latitude NUMERIC,
  longitude NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMP WITH TIME ZONE,
  last_opened_at TIMESTAMP WITH TIME ZONE
);

-- Create daily_assessment_beginning_of_day table
CREATE TABLE public.daily_assessment_beginning_of_day (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assessment_id UUID NOT NULL REFERENCES public.daily_assessments(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  is_complete BOOLEAN NOT NULL DEFAULT false,
  comments TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create daily_assessment_end_of_day table
CREATE TABLE public.daily_assessment_end_of_day (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assessment_id UUID NOT NULL REFERENCES public.daily_assessments(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  is_complete BOOLEAN NOT NULL DEFAULT false,
  comments TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create daily_assessment_operating_systems table
CREATE TABLE public.daily_assessment_operating_systems (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assessment_id UUID NOT NULL REFERENCES public.daily_assessments(id) ON DELETE CASCADE,
  system_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create daily_assessment_equipment_checks table
CREATE TABLE public.daily_assessment_equipment_checks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assessment_id UUID NOT NULL REFERENCES public.daily_assessments(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  is_checked BOOLEAN NOT NULL DEFAULT false,
  comments TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create daily_assessment_structure_checks table
CREATE TABLE public.daily_assessment_structure_checks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assessment_id UUID NOT NULL REFERENCES public.daily_assessments(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  is_checked BOOLEAN NOT NULL DEFAULT false,
  comments TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create daily_assessment_environment_checks table
CREATE TABLE public.daily_assessment_environment_checks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assessment_id UUID NOT NULL REFERENCES public.daily_assessments(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  is_checked BOOLEAN NOT NULL DEFAULT false,
  comments TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.daily_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_assessment_beginning_of_day ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_assessment_end_of_day ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_assessment_operating_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_assessment_equipment_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_assessment_structure_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_assessment_environment_checks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for daily_assessments
CREATE POLICY "Inspectors can view their own assessments"
ON public.daily_assessments FOR SELECT
USING (auth.uid() = inspector_id);

CREATE POLICY "Inspectors can create their own assessments"
ON public.daily_assessments FOR INSERT
WITH CHECK (auth.uid() = inspector_id);

CREATE POLICY "Inspectors can update their own assessments"
ON public.daily_assessments FOR UPDATE
USING (auth.uid() = inspector_id);

CREATE POLICY "Inspectors can delete their own assessments"
ON public.daily_assessments FOR DELETE
USING (auth.uid() = inspector_id);

CREATE POLICY "Super admins can view all assessments"
ON public.daily_assessments FOR SELECT
USING (is_super_admin());

CREATE POLICY "Super admins can insert all assessments"
ON public.daily_assessments FOR INSERT
WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update all assessments"
ON public.daily_assessments FOR UPDATE
USING (is_super_admin());

CREATE POLICY "Super admins can delete all assessments"
ON public.daily_assessments FOR DELETE
USING (is_super_admin());

-- RLS Policies for beginning_of_day
CREATE POLICY "Users can manage beginning_of_day for their assessments"
ON public.daily_assessment_beginning_of_day FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.daily_assessments
    WHERE daily_assessments.id = daily_assessment_beginning_of_day.assessment_id
    AND daily_assessments.inspector_id = auth.uid()
  )
);

-- RLS Policies for end_of_day
CREATE POLICY "Users can manage end_of_day for their assessments"
ON public.daily_assessment_end_of_day FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.daily_assessments
    WHERE daily_assessments.id = daily_assessment_end_of_day.assessment_id
    AND daily_assessments.inspector_id = auth.uid()
  )
);

-- RLS Policies for operating_systems
CREATE POLICY "Users can manage operating_systems for their assessments"
ON public.daily_assessment_operating_systems FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.daily_assessments
    WHERE daily_assessments.id = daily_assessment_operating_systems.assessment_id
    AND daily_assessments.inspector_id = auth.uid()
  )
);

-- RLS Policies for equipment_checks
CREATE POLICY "Users can manage equipment_checks for their assessments"
ON public.daily_assessment_equipment_checks FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.daily_assessments
    WHERE daily_assessments.id = daily_assessment_equipment_checks.assessment_id
    AND daily_assessments.inspector_id = auth.uid()
  )
);

-- RLS Policies for structure_checks
CREATE POLICY "Users can manage structure_checks for their assessments"
ON public.daily_assessment_structure_checks FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.daily_assessments
    WHERE daily_assessments.id = daily_assessment_structure_checks.assessment_id
    AND daily_assessments.inspector_id = auth.uid()
  )
);

-- RLS Policies for environment_checks
CREATE POLICY "Users can manage environment_checks for their assessments"
ON public.daily_assessment_environment_checks FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.daily_assessments
    WHERE daily_assessments.id = daily_assessment_environment_checks.assessment_id
    AND daily_assessments.inspector_id = auth.uid()
  )
);

-- Add trigger for updated_at
CREATE TRIGGER update_daily_assessments_updated_at
BEFORE UPDATE ON public.daily_assessments
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Auto-link organization
CREATE TRIGGER auto_link_daily_assessment_organization
BEFORE INSERT OR UPDATE ON public.daily_assessments
FOR EACH ROW
EXECUTE FUNCTION public.auto_link_organization();