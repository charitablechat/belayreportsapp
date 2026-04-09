
-- =============================================
-- Admin RLS policies for ALL report child tables
-- Using is_admin_or_above() to match parent table access
-- =============================================

-- INSPECTION CHILD TABLES

CREATE POLICY "Admins can manage all inspection systems"
ON public.inspection_systems FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all inspection ziplines"
ON public.inspection_ziplines FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all inspection equipment"
ON public.inspection_equipment FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all inspection standards"
ON public.inspection_standards FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all inspection summaries"
ON public.inspection_summary FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all inspection photos"
ON public.inspection_photos FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

-- TRAINING CHILD TABLES

CREATE POLICY "Admins can manage all training delivery approaches"
ON public.training_delivery_approaches FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all training operating systems"
ON public.training_operating_systems FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all training immediate attention"
ON public.training_immediate_attention FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all training verifiable items"
ON public.training_verifiable_items FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all training systems in place"
ON public.training_systems_in_place FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all training summaries"
ON public.training_summary FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all training photos"
ON public.training_photos FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

-- DAILY ASSESSMENT CHILD TABLES

CREATE POLICY "Admins can manage all beginning of day checks"
ON public.daily_assessment_beginning_of_day FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all end of day checks"
ON public.daily_assessment_end_of_day FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all environment checks"
ON public.daily_assessment_environment_checks FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all equipment checks"
ON public.daily_assessment_equipment_checks FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all structure checks"
ON public.daily_assessment_structure_checks FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all daily assessment operating systems"
ON public.daily_assessment_operating_systems FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());

CREATE POLICY "Admins can manage all daily assessment photos"
ON public.daily_assessment_photos FOR ALL TO authenticated
USING (is_admin_or_above()) WITH CHECK (is_admin_or_above());
