
-- 1. Add display_order to training_photos (missing for drag-and-drop)
ALTER TABLE public.training_photos ADD COLUMN IF NOT EXISTS display_order integer;

-- 2. Create daily_assessment_photos table (mirrors training_photos structure)
CREATE TABLE IF NOT EXISTS public.daily_assessment_photos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assessment_id UUID NOT NULL REFERENCES public.daily_assessments(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  photo_section TEXT,
  caption TEXT,
  display_order INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.daily_assessment_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage photos for their assessments"
  ON public.daily_assessment_photos FOR ALL
  USING (EXISTS (
    SELECT 1 FROM daily_assessments
    WHERE daily_assessments.id = daily_assessment_photos.assessment_id
    AND daily_assessments.inspector_id = auth.uid()
  ));

CREATE POLICY "Super admins can manage all daily assessment photos"
  ON public.daily_assessment_photos FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- 3. Create training-photos storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('training-photos', 'training-photos', false)
ON CONFLICT (id) DO NOTHING;

-- 4. Create daily-assessment-photos storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('daily-assessment-photos', 'daily-assessment-photos', false)
ON CONFLICT (id) DO NOTHING;

-- 5. Storage RLS for training-photos bucket (mirrors inspection-photos pattern)
CREATE POLICY "Users can upload training photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'training-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view their training photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'training-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their training photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'training-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Super admins can manage all training photos storage"
  ON storage.objects FOR ALL
  USING (bucket_id = 'training-photos' AND is_super_admin())
  WITH CHECK (bucket_id = 'training-photos' AND is_super_admin());

-- 6. Storage RLS for daily-assessment-photos bucket
CREATE POLICY "Users can upload daily assessment photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'daily-assessment-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view their daily assessment photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'daily-assessment-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their daily assessment photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'daily-assessment-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Super admins can manage all daily assessment photos storage"
  ON storage.objects FOR ALL
  USING (bucket_id = 'daily-assessment-photos' AND is_super_admin())
  WITH CHECK (bucket_id = 'daily-assessment-photos' AND is_super_admin());
