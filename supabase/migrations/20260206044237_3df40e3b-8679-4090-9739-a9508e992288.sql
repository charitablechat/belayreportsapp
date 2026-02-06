-- =============================================
-- v2.4.1: Super Admin SELECT Policies for Child Tables
-- =============================================

-- INSPECTION CHILD TABLES (6 policies)

CREATE POLICY "Super admins can view all inspection systems"
  ON public.inspection_systems FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can view all inspection ziplines"
  ON public.inspection_ziplines FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can view all inspection equipment"
  ON public.inspection_equipment FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can view all inspection standards"
  ON public.inspection_standards FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can view all inspection summaries"
  ON public.inspection_summary FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can view all inspection photos"
  ON public.inspection_photos FOR SELECT
  USING (is_super_admin());

-- DAILY ASSESSMENT CHILD TABLES (6 policies)

CREATE POLICY "Super admins can view all beginning of day checks"
  ON public.daily_assessment_beginning_of_day FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can view all end of day checks"
  ON public.daily_assessment_end_of_day FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can view all environment checks"
  ON public.daily_assessment_environment_checks FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can view all equipment checks"
  ON public.daily_assessment_equipment_checks FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can view all daily assessment operating systems"
  ON public.daily_assessment_operating_systems FOR SELECT
  USING (is_super_admin());

CREATE POLICY "Super admins can view all structure checks"
  ON public.daily_assessment_structure_checks FOR SELECT
  USING (is_super_admin());

-- STORAGE BUCKET POLICY (1 policy)

CREATE POLICY "Super admins can view all inspection photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'inspection-photos' 
    AND is_super_admin()
  );