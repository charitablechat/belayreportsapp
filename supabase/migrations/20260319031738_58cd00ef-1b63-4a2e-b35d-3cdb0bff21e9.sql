-- Create a reusable function to check if user is admin or super_admin
CREATE OR REPLACE FUNCTION public.is_admin_or_above()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'super_admin')
  )
$$;

-- Drop old permissive SELECT policy that allowed all authenticated users
DROP POLICY IF EXISTS "Authenticated users can view published resources" ON public.onboarding_resources;

-- New policy: only admin/super_admin can view resources
CREATE POLICY "Admins can view all resources"
ON public.onboarding_resources
FOR SELECT
TO authenticated
USING (is_admin_or_above());

-- Update onboarding_progress policies to restrict to admin/super_admin
DROP POLICY IF EXISTS "Users can view own progress" ON public.onboarding_progress;
DROP POLICY IF EXISTS "Users can insert own progress" ON public.onboarding_progress;
DROP POLICY IF EXISTS "Users can delete own progress" ON public.onboarding_progress;

CREATE POLICY "Admins can view own progress"
ON public.onboarding_progress
FOR SELECT
TO authenticated
USING (user_id = auth.uid() AND is_admin_or_above());

CREATE POLICY "Admins can insert own progress"
ON public.onboarding_progress
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() AND is_admin_or_above());

CREATE POLICY "Admins can delete own progress"
ON public.onboarding_progress
FOR DELETE
TO authenticated
USING (user_id = auth.uid() AND is_admin_or_above());