-- Fix RLS policies for daily_assessment_beginning_of_day
DROP POLICY IF EXISTS "Users can manage beginning_of_day for their assessments" ON daily_assessment_beginning_of_day;

CREATE POLICY "Users can view beginning_of_day for their assessments"
ON daily_assessment_beginning_of_day FOR SELECT
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can insert beginning_of_day for their assessments"
ON daily_assessment_beginning_of_day FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can update beginning_of_day for their assessments"
ON daily_assessment_beginning_of_day FOR UPDATE
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can delete beginning_of_day for their assessments"
ON daily_assessment_beginning_of_day FOR DELETE
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

-- Fix RLS policies for daily_assessment_end_of_day
DROP POLICY IF EXISTS "Users can manage end_of_day for their assessments" ON daily_assessment_end_of_day;

CREATE POLICY "Users can view end_of_day for their assessments"
ON daily_assessment_end_of_day FOR SELECT
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can insert end_of_day for their assessments"
ON daily_assessment_end_of_day FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can update end_of_day for their assessments"
ON daily_assessment_end_of_day FOR UPDATE
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can delete end_of_day for their assessments"
ON daily_assessment_end_of_day FOR DELETE
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

-- Fix RLS policies for daily_assessment_operating_systems
DROP POLICY IF EXISTS "Users can manage operating_systems for their assessments" ON daily_assessment_operating_systems;

CREATE POLICY "Users can view operating_systems for their assessments"
ON daily_assessment_operating_systems FOR SELECT
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can insert operating_systems for their assessments"
ON daily_assessment_operating_systems FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can update operating_systems for their assessments"
ON daily_assessment_operating_systems FOR UPDATE
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can delete operating_systems for their assessments"
ON daily_assessment_operating_systems FOR DELETE
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

-- Fix RLS policies for daily_assessment_equipment_checks
DROP POLICY IF EXISTS "Users can manage equipment_checks for their assessments" ON daily_assessment_equipment_checks;

CREATE POLICY "Users can view equipment_checks for their assessments"
ON daily_assessment_equipment_checks FOR SELECT
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can insert equipment_checks for their assessments"
ON daily_assessment_equipment_checks FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can update equipment_checks for their assessments"
ON daily_assessment_equipment_checks FOR UPDATE
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can delete equipment_checks for their assessments"
ON daily_assessment_equipment_checks FOR DELETE
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

-- Fix RLS policies for daily_assessment_structure_checks
DROP POLICY IF EXISTS "Users can manage structure_checks for their assessments" ON daily_assessment_structure_checks;

CREATE POLICY "Users can view structure_checks for their assessments"
ON daily_assessment_structure_checks FOR SELECT
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can insert structure_checks for their assessments"
ON daily_assessment_structure_checks FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can update structure_checks for their assessments"
ON daily_assessment_structure_checks FOR UPDATE
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can delete structure_checks for their assessments"
ON daily_assessment_structure_checks FOR DELETE
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

-- Fix RLS policies for daily_assessment_environment_checks
DROP POLICY IF EXISTS "Users can manage environment_checks for their assessments" ON daily_assessment_environment_checks;

CREATE POLICY "Users can view environment_checks for their assessments"
ON daily_assessment_environment_checks FOR SELECT
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can insert environment_checks for their assessments"
ON daily_assessment_environment_checks FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can update environment_checks for their assessments"
ON daily_assessment_environment_checks FOR UPDATE
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));

CREATE POLICY "Users can delete environment_checks for their assessments"
ON daily_assessment_environment_checks FOR DELETE
USING (EXISTS (SELECT 1 FROM daily_assessments WHERE id = assessment_id AND inspector_id = auth.uid()));