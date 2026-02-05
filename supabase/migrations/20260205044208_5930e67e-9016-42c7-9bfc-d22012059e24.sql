
-- Add UPDATE policies for super admins on inspections and trainings
-- This allows super admins to update any report (for administrative purposes)

-- Super admin UPDATE policy for inspections
CREATE POLICY "Super admins can update all inspections"
ON public.inspections
FOR UPDATE
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Super admin UPDATE policy for trainings
CREATE POLICY "Super admins can update all trainings"
ON public.trainings
FOR UPDATE
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Super admin UPDATE policy for daily_assessments
CREATE POLICY "Super admins can update all daily assessments"
ON public.daily_assessments
FOR UPDATE
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Add simpler SELECT policies for super admins (without deleted_at check in the policy itself)
-- The dashboard queries will handle filtering by deleted_at, but these ensure access
CREATE POLICY "Super admins can view all inspections"
ON public.inspections
FOR SELECT
USING (is_super_admin());

CREATE POLICY "Super admins can view all trainings"
ON public.trainings
FOR SELECT
USING (is_super_admin());
