-- Create inspections table
CREATE TABLE public.inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  organization TEXT NOT NULL,
  location TEXT NOT NULL,
  onsite_contact TEXT,
  inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
  previous_inspector TEXT,
  previous_inspection_date DATE,
  course_history TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  status TEXT NOT NULL DEFAULT 'draft', -- draft, completed, synced
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ
);

-- Create inspection_systems table (for Operating Systems section)
CREATE TABLE public.inspection_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID REFERENCES public.inspections(id) ON DELETE CASCADE NOT NULL,
  system_name TEXT NOT NULL,
  result TEXT NOT NULL, -- Pass, Pass w/Provisions, Fail
  comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create inspection_ziplines table
CREATE TABLE public.inspection_ziplines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID REFERENCES public.inspections(id) ON DELETE CASCADE NOT NULL,
  zipline_name TEXT NOT NULL,
  cable_length INTEGER,
  unload_tension INTEGER,
  load_tension INTEGER,
  cable_type TEXT,
  braking_system TEXT,
  ead_system TEXT,
  cable_result TEXT,
  braking_result TEXT,
  ead_result TEXT,
  result TEXT NOT NULL, -- Pass, Pass w/Provisions, Fail
  comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create inspection_equipment table
CREATE TABLE public.inspection_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID REFERENCES public.inspections(id) ON DELETE CASCADE NOT NULL,
  equipment_category TEXT NOT NULL, -- harnesses, helmets, lanyards, connectors, rope, belay, trolleys, other
  equipment_type TEXT NOT NULL,
  production_year INTEGER,
  quantity INTEGER,
  result TEXT NOT NULL, -- Pass, Pass w/Provisions, Fail, N/A
  comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create inspection_standards table (for ACCT Standards)
CREATE TABLE public.inspection_standards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID REFERENCES public.inspections(id) ON DELETE CASCADE NOT NULL,
  standard_name TEXT NOT NULL,
  has_documentation BOOLEAN NOT NULL,
  comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create inspection_photos table
CREATE TABLE public.inspection_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID REFERENCES public.inspections(id) ON DELETE CASCADE NOT NULL,
  photo_url TEXT NOT NULL,
  photo_section TEXT, -- which section the photo relates to
  caption TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create inspection_summary table
CREATE TABLE public.inspection_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID REFERENCES public.inspections(id) ON DELETE CASCADE NOT NULL,
  repairs_performed TEXT,
  critical_actions TEXT,
  future_considerations TEXT,
  next_inspection_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_ziplines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_standards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_summary ENABLE ROW LEVEL SECURITY;

-- RLS Policies for inspections - inspectors can manage their own
CREATE POLICY "Inspectors can view their own inspections"
  ON public.inspections FOR SELECT
  USING (auth.uid() = inspector_id);

CREATE POLICY "Inspectors can create their own inspections"
  ON public.inspections FOR INSERT
  WITH CHECK (auth.uid() = inspector_id);

CREATE POLICY "Inspectors can update their own inspections"
  ON public.inspections FOR UPDATE
  USING (auth.uid() = inspector_id);

CREATE POLICY "Inspectors can delete their own inspections"
  ON public.inspections FOR DELETE
  USING (auth.uid() = inspector_id);

-- RLS Policies for inspection_systems
CREATE POLICY "Users can manage systems for their inspections"
  ON public.inspection_systems FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.inspections
      WHERE inspections.id = inspection_systems.inspection_id
      AND inspections.inspector_id = auth.uid()
    )
  );

-- RLS Policies for inspection_ziplines
CREATE POLICY "Users can manage ziplines for their inspections"
  ON public.inspection_ziplines FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.inspections
      WHERE inspections.id = inspection_ziplines.inspection_id
      AND inspections.inspector_id = auth.uid()
    )
  );

-- RLS Policies for inspection_equipment
CREATE POLICY "Users can manage equipment for their inspections"
  ON public.inspection_equipment FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.inspections
      WHERE inspections.id = inspection_equipment.inspection_id
      AND inspections.inspector_id = auth.uid()
    )
  );

-- RLS Policies for inspection_standards
CREATE POLICY "Users can manage standards for their inspections"
  ON public.inspection_standards FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.inspections
      WHERE inspections.id = inspection_standards.inspection_id
      AND inspections.inspector_id = auth.uid()
    )
  );

-- RLS Policies for inspection_photos
CREATE POLICY "Users can manage photos for their inspections"
  ON public.inspection_photos FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.inspections
      WHERE inspections.id = inspection_photos.inspection_id
      AND inspections.inspector_id = auth.uid()
    )
  );

-- RLS Policies for inspection_summary
CREATE POLICY "Users can manage summary for their inspections"
  ON public.inspection_summary FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.inspections
      WHERE inspections.id = inspection_summary.inspection_id
      AND inspections.inspector_id = auth.uid()
    )
  );

-- Create storage bucket for inspection photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('inspection-photos', 'inspection-photos', false);

-- Storage policies for inspection photos
CREATE POLICY "Users can upload photos for their inspections"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'inspection-photos' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view photos for their inspections"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'inspection-photos' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Update trigger for inspections
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_inspections_updated_at
  BEFORE UPDATE ON public.inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();