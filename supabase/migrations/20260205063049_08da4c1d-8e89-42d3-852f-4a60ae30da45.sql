-- Super Admin UPDATE policies for inspection child tables
CREATE POLICY "Super admins can update all inspection systems"
  ON inspection_systems FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update all inspection ziplines"
  ON inspection_ziplines FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update all inspection equipment"
  ON inspection_equipment FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update all inspection standards"
  ON inspection_standards FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update all inspection summaries"
  ON inspection_summary FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update all inspection photos"
  ON inspection_photos FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- Super Admin UPDATE policies for daily assessment child tables
CREATE POLICY "Super admins can update all beginning of day checks"
  ON daily_assessment_beginning_of_day FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update all end of day checks"
  ON daily_assessment_end_of_day FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update all environment checks"
  ON daily_assessment_environment_checks FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update all equipment checks"
  ON daily_assessment_equipment_checks FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update all daily assessment operating systems"
  ON daily_assessment_operating_systems FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY "Super admins can update all structure checks"
  ON daily_assessment_structure_checks FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());