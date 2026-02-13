
-- Add missing INSERT and DELETE RLS policies for super admins on inspection child tables

-- inspection_equipment
CREATE POLICY "Super admins can insert inspection equipment"
  ON public.inspection_equipment FOR INSERT
  TO public WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can delete inspection equipment"
  ON public.inspection_equipment FOR DELETE
  TO public USING (is_super_admin());

-- inspection_systems
CREATE POLICY "Super admins can insert inspection systems"
  ON public.inspection_systems FOR INSERT
  TO public WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can delete inspection systems"
  ON public.inspection_systems FOR DELETE
  TO public USING (is_super_admin());

-- inspection_ziplines
CREATE POLICY "Super admins can insert inspection ziplines"
  ON public.inspection_ziplines FOR INSERT
  TO public WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can delete inspection ziplines"
  ON public.inspection_ziplines FOR DELETE
  TO public USING (is_super_admin());

-- inspection_standards
CREATE POLICY "Super admins can insert inspection standards"
  ON public.inspection_standards FOR INSERT
  TO public WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can delete inspection standards"
  ON public.inspection_standards FOR DELETE
  TO public USING (is_super_admin());

-- inspection_summary
CREATE POLICY "Super admins can insert inspection summaries"
  ON public.inspection_summary FOR INSERT
  TO public WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can delete inspection summaries"
  ON public.inspection_summary FOR DELETE
  TO public USING (is_super_admin());
