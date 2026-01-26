-- Update RLS policies to exclude soft-deleted records for normal users
-- Only super admins can see deleted records through the get_deleted_records function

-- Drop and recreate inspections policies to include soft-delete filter
DROP POLICY IF EXISTS "Inspectors can view their own inspections" ON public.inspections;
DROP POLICY IF EXISTS "Users can view their own inspections" ON public.inspections;
DROP POLICY IF EXISTS "Super admins can view all inspections" ON public.inspections;

-- Recreate with soft-delete filter
CREATE POLICY "Users can view their own active inspections" 
ON public.inspections 
FOR SELECT 
USING (inspector_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "Super admins can view all active inspections" 
ON public.inspections 
FOR SELECT 
USING (is_super_admin() AND deleted_at IS NULL);

-- Update policy for super admins to also see deleted records (for recovery)
CREATE POLICY "Super admins can view deleted inspections for recovery" 
ON public.inspections 
FOR SELECT 
USING (is_super_admin() AND deleted_at IS NOT NULL);

-- Update policies for trainings
DROP POLICY IF EXISTS "Users can view their own trainings" ON public.trainings;
DROP POLICY IF EXISTS "Super admins can view all trainings" ON public.trainings;

CREATE POLICY "Users can view their own active trainings" 
ON public.trainings 
FOR SELECT 
USING (inspector_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "Super admins can view all active trainings" 
ON public.trainings 
FOR SELECT 
USING (is_super_admin() AND deleted_at IS NULL);

CREATE POLICY "Super admins can view deleted trainings for recovery" 
ON public.trainings 
FOR SELECT 
USING (is_super_admin() AND deleted_at IS NOT NULL);

-- Update policies for daily_assessments
DROP POLICY IF EXISTS "Users can view their own assessments" ON public.daily_assessments;
DROP POLICY IF EXISTS "Users can view their own daily assessments" ON public.daily_assessments;
DROP POLICY IF EXISTS "Super admins can view all daily assessments" ON public.daily_assessments;

CREATE POLICY "Users can view their own active daily assessments" 
ON public.daily_assessments 
FOR SELECT 
USING (inspector_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "Super admins can view all active daily assessments" 
ON public.daily_assessments 
FOR SELECT 
USING (is_super_admin() AND deleted_at IS NULL);

CREATE POLICY "Super admins can view deleted daily assessments for recovery" 
ON public.daily_assessments 
FOR SELECT 
USING (is_super_admin() AND deleted_at IS NOT NULL);

-- Update UPDATE policies to allow soft-delete operations
DROP POLICY IF EXISTS "Users can update their own inspections" ON public.inspections;
DROP POLICY IF EXISTS "Super admins can update all inspections" ON public.inspections;

CREATE POLICY "Users can update their own active inspections" 
ON public.inspections 
FOR UPDATE 
USING (inspector_id = auth.uid() AND deleted_at IS NULL)
WITH CHECK (inspector_id = auth.uid());

CREATE POLICY "Super admins can update all inspections" 
ON public.inspections 
FOR UPDATE 
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Update trainings UPDATE policies
DROP POLICY IF EXISTS "Users can update their own trainings" ON public.trainings;
DROP POLICY IF EXISTS "Super admins can update all trainings" ON public.trainings;

CREATE POLICY "Users can update their own active trainings" 
ON public.trainings 
FOR UPDATE 
USING (inspector_id = auth.uid() AND deleted_at IS NULL)
WITH CHECK (inspector_id = auth.uid());

CREATE POLICY "Super admins can update all trainings" 
ON public.trainings 
FOR UPDATE 
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Update daily_assessments UPDATE policies
DROP POLICY IF EXISTS "Users can update their own assessments" ON public.daily_assessments;
DROP POLICY IF EXISTS "Users can update their own daily assessments" ON public.daily_assessments;
DROP POLICY IF EXISTS "Super admins can update all daily assessments" ON public.daily_assessments;

CREATE POLICY "Users can update their own active daily assessments" 
ON public.daily_assessments 
FOR UPDATE 
USING (inspector_id = auth.uid() AND deleted_at IS NULL)
WITH CHECK (inspector_id = auth.uid());

CREATE POLICY "Super admins can update all daily assessments" 
ON public.daily_assessments 
FOR UPDATE 
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- DELETE policies now only for super admins (permanent deletion)
DROP POLICY IF EXISTS "Users can delete their own inspections" ON public.inspections;
DROP POLICY IF EXISTS "Super admins can delete all inspections" ON public.inspections;
DROP POLICY IF EXISTS "Users can delete their own trainings" ON public.trainings;
DROP POLICY IF EXISTS "Super admins can delete all trainings" ON public.trainings;
DROP POLICY IF EXISTS "Users can delete their own assessments" ON public.daily_assessments;
DROP POLICY IF EXISTS "Users can delete their own daily assessments" ON public.daily_assessments;
DROP POLICY IF EXISTS "Super admins can delete all daily assessments" ON public.daily_assessments;

-- Only super admins can permanently delete (for expired retention cleanup)
CREATE POLICY "Super admins can permanently delete inspections" 
ON public.inspections 
FOR DELETE 
USING (is_super_admin());

CREATE POLICY "Super admins can permanently delete trainings" 
ON public.trainings 
FOR DELETE 
USING (is_super_admin());

CREATE POLICY "Super admins can permanently delete daily assessments" 
ON public.daily_assessments 
FOR DELETE 
USING (is_super_admin());