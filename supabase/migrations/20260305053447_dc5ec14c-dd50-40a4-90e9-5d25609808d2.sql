
-- 1. Create onboarding_resources table
CREATE TABLE public.onboarding_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  file_type text NOT NULL CHECK (file_type IN ('video', 'pdf')),
  file_url text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Create onboarding_progress table
CREATE TABLE public.onboarding_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  resource_id uuid NOT NULL REFERENCES public.onboarding_resources(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, resource_id)
);

-- 3. Enable RLS
ALTER TABLE public.onboarding_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

-- 4. RLS for onboarding_resources
CREATE POLICY "Super admins can manage onboarding resources"
  ON public.onboarding_resources
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Authenticated users can view published resources"
  ON public.onboarding_resources
  FOR SELECT
  TO authenticated
  USING (is_published = true);

-- 5. RLS for onboarding_progress
CREATE POLICY "Users can view own progress"
  ON public.onboarding_progress
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own progress"
  ON public.onboarding_progress
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own progress"
  ON public.onboarding_progress
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- 6. Create storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('onboarding-files', 'onboarding-files', false);

-- 7. Storage RLS: super admins can upload
CREATE POLICY "Super admins can upload onboarding files"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'onboarding-files' AND public.is_super_admin());

CREATE POLICY "Super admins can update onboarding files"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'onboarding-files' AND public.is_super_admin());

CREATE POLICY "Super admins can delete onboarding files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'onboarding-files' AND public.is_super_admin());

-- 8. Storage RLS: authenticated users can read
CREATE POLICY "Authenticated users can read onboarding files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'onboarding-files');
