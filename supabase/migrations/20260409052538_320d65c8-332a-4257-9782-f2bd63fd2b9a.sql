
-- Add admin SELECT policy for inspections
CREATE POLICY "Admins can view all inspections"
ON public.inspections
FOR SELECT
TO authenticated
USING (is_admin_or_above());

-- Add admin SELECT policy for trainings
CREATE POLICY "Admins can view all trainings"
ON public.trainings
FOR SELECT
TO authenticated
USING (is_admin_or_above());

-- Add admin SELECT policy for daily_assessments
CREATE POLICY "Admins can view all daily assessments"
ON public.daily_assessments
FOR SELECT
TO authenticated
USING (is_admin_or_above());
