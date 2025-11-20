-- Create storage bucket for inspection reports (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('inspection-reports', 'inspection-reports', false);

-- Create inspection_reports metadata table
CREATE TABLE public.inspection_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  pdf_url TEXT NOT NULL,
  file_size_bytes INTEGER,
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  generated_by UUID REFERENCES auth.users(id),
  version INTEGER DEFAULT 1,
  metadata JSONB
);

-- Enable RLS on inspection_reports
ALTER TABLE public.inspection_reports ENABLE ROW LEVEL SECURITY;

-- Inspectors can view their own reports
CREATE POLICY "Inspectors can view their own reports"
  ON public.inspection_reports FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.inspections
      WHERE inspections.id = inspection_reports.inspection_id
      AND inspections.inspector_id = auth.uid()
    )
  );

-- Super admins can view all reports
CREATE POLICY "Super admins can view all reports"
  ON public.inspection_reports FOR SELECT
  USING (is_super_admin());

-- Storage RLS for inspection-reports bucket
CREATE POLICY "Users can read their own reports"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'inspection-reports' AND
    EXISTS (
      SELECT 1 FROM public.inspection_reports ir
      JOIN public.inspections i ON i.id = ir.inspection_id
      WHERE storage.objects.name LIKE '%' || ir.inspection_id::text || '%'
      AND (i.inspector_id = auth.uid() OR is_super_admin())
    )
  );

-- Service role can insert PDFs
CREATE POLICY "Service role can upload PDFs"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'inspection-reports');