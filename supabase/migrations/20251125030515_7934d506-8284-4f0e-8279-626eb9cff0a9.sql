-- Create trainings table
CREATE TABLE public.trainings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inspector_id UUID NOT NULL,
  organization TEXT NOT NULL,
  organization_id UUID REFERENCES public.organizations(id),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE NOT NULL DEFAULT CURRENT_DATE,
  trainer_of_record TEXT,
  trainee_names TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  latitude NUMERIC,
  longitude NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMP WITH TIME ZONE,
  last_opened_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.trainings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for trainings
CREATE POLICY "Trainers can view their own trainings"
  ON public.trainings FOR SELECT
  USING (auth.uid() = inspector_id);

CREATE POLICY "Trainers can create their own trainings"
  ON public.trainings FOR INSERT
  WITH CHECK (auth.uid() = inspector_id);

CREATE POLICY "Trainers can update their own trainings"
  ON public.trainings FOR UPDATE
  USING (auth.uid() = inspector_id);

CREATE POLICY "Trainers can delete their own trainings"
  ON public.trainings FOR DELETE
  USING (auth.uid() = inspector_id);

CREATE POLICY "Super admins can view all trainings"
  ON public.trainings FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can insert all trainings"
  ON public.trainings FOR INSERT
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update all trainings"
  ON public.trainings FOR UPDATE
  USING (is_super_admin());

CREATE POLICY "Super admins can delete all trainings"
  ON public.trainings FOR DELETE
  USING (is_super_admin());

-- Auto-link organization trigger
CREATE TRIGGER auto_link_training_organization
  BEFORE INSERT OR UPDATE ON public.trainings
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_organization();

-- Updated at trigger
CREATE TRIGGER handle_training_updated_at
  BEFORE UPDATE ON public.trainings
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Create training_delivery_approaches table
CREATE TABLE public.training_delivery_approaches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  training_id UUID NOT NULL REFERENCES public.trainings(id) ON DELETE CASCADE,
  approach TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.training_delivery_approaches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage delivery approaches for their trainings"
  ON public.training_delivery_approaches FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.trainings
    WHERE trainings.id = training_delivery_approaches.training_id
    AND trainings.inspector_id = auth.uid()
  ));

-- Create training_operating_systems table
CREATE TABLE public.training_operating_systems (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  training_id UUID NOT NULL REFERENCES public.trainings(id) ON DELETE CASCADE,
  system_name TEXT NOT NULL,
  other_description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.training_operating_systems ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage operating systems for their trainings"
  ON public.training_operating_systems FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.trainings
    WHERE trainings.id = training_operating_systems.training_id
    AND trainings.inspector_id = auth.uid()
  ));

-- Create training_immediate_attention table
CREATE TABLE public.training_immediate_attention (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  training_id UUID NOT NULL REFERENCES public.trainings(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.training_immediate_attention ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage immediate attention items for their trainings"
  ON public.training_immediate_attention FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.trainings
    WHERE trainings.id = training_immediate_attention.training_id
    AND trainings.inspector_id = auth.uid()
  ));

-- Create training_verifiable_items table
CREATE TABLE public.training_verifiable_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  training_id UUID NOT NULL REFERENCES public.trainings(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.training_verifiable_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage verifiable items for their trainings"
  ON public.training_verifiable_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.trainings
    WHERE trainings.id = training_verifiable_items.training_id
    AND trainings.inspector_id = auth.uid()
  ));

-- Create training_systems_in_place table
CREATE TABLE public.training_systems_in_place (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  training_id UUID NOT NULL REFERENCES public.trainings(id) ON DELETE CASCADE,
  system_item TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.training_systems_in_place ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage systems in place for their trainings"
  ON public.training_systems_in_place FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.trainings
    WHERE trainings.id = training_systems_in_place.training_id
    AND trainings.inspector_id = auth.uid()
  ));

-- Create training_summary table
CREATE TABLE public.training_summary (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  training_id UUID NOT NULL REFERENCES public.trainings(id) ON DELETE CASCADE,
  observations TEXT,
  recommendations TEXT,
  person_submitting TEXT,
  submission_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.training_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage summary for their trainings"
  ON public.training_summary FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.trainings
    WHERE trainings.id = training_summary.training_id
    AND trainings.inspector_id = auth.uid()
  ));

-- Create training_photos table
CREATE TABLE public.training_photos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  training_id UUID NOT NULL REFERENCES public.trainings(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  photo_section TEXT,
  caption TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.training_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage photos for their trainings"
  ON public.training_photos FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.trainings
    WHERE trainings.id = training_photos.training_id
    AND trainings.inspector_id = auth.uid()
  ));

-- Create training_reports table
CREATE TABLE public.training_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  training_id UUID NOT NULL REFERENCES public.trainings(id) ON DELETE CASCADE,
  pdf_url TEXT NOT NULL,
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  generated_by UUID,
  version INTEGER DEFAULT 1,
  file_size_bytes INTEGER,
  metadata JSONB
);

ALTER TABLE public.training_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trainers can view their own reports"
  ON public.training_reports FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.trainings
    WHERE trainings.id = training_reports.training_id
    AND trainings.inspector_id = auth.uid()
  ));

CREATE POLICY "Super admins can view all reports"
  ON public.training_reports FOR SELECT
  USING (is_super_admin());