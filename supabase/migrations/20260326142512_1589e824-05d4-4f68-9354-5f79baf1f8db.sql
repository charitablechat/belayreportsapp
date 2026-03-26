
-- Fix RLS UPDATE policies for soft-delete on inspections, trainings, daily_assessments

-- ============ INSPECTIONS ============
DROP POLICY IF EXISTS "Inspectors can update their own inspections" ON public.inspections;
DROP POLICY IF EXISTS "Users can update their own active inspections" ON public.inspections;

CREATE POLICY "Users can update their own inspections"
  ON public.inspections FOR UPDATE TO authenticated
  USING (inspector_id = auth.uid())
  WITH CHECK (inspector_id = auth.uid());

CREATE POLICY "Admins can update all inspections"
  ON public.inspections FOR UPDATE TO authenticated
  USING (is_admin_or_above())
  WITH CHECK (is_admin_or_above());

-- ============ TRAININGS ============
DROP POLICY IF EXISTS "Trainers can update their own trainings" ON public.trainings;
DROP POLICY IF EXISTS "Users can update their own active trainings" ON public.trainings;

CREATE POLICY "Users can update their own trainings"
  ON public.trainings FOR UPDATE TO authenticated
  USING (inspector_id = auth.uid())
  WITH CHECK (inspector_id = auth.uid());

CREATE POLICY "Admins can update all trainings"
  ON public.trainings FOR UPDATE TO authenticated
  USING (is_admin_or_above())
  WITH CHECK (is_admin_or_above());

-- ============ DAILY ASSESSMENTS ============
DROP POLICY IF EXISTS "Inspectors can update their own assessments" ON public.daily_assessments;
DROP POLICY IF EXISTS "Users can update their own active assessments" ON public.daily_assessments;

CREATE POLICY "Users can update their own assessments"
  ON public.daily_assessments FOR UPDATE TO authenticated
  USING (inspector_id = auth.uid())
  WITH CHECK (inspector_id = auth.uid());

CREATE POLICY "Admins can update all assessments"
  ON public.daily_assessments FOR UPDATE TO authenticated
  USING (is_admin_or_above())
  WITH CHECK (is_admin_or_above());
