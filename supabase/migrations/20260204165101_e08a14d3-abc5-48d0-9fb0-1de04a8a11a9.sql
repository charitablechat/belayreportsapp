-- Fix RLS policies for inspection child tables - add explicit WITH CHECK clauses
-- This fixes INSERT failures during mobile sync when parent inspection exists

-- Fix inspection_systems
DROP POLICY IF EXISTS "Users can manage systems for their inspections" ON inspection_systems;
CREATE POLICY "Users can manage systems for their inspections" ON inspection_systems
FOR ALL 
USING (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_systems.inspection_id AND inspections.inspector_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_systems.inspection_id AND inspections.inspector_id = auth.uid()));

-- Fix inspection_ziplines  
DROP POLICY IF EXISTS "Users can manage ziplines for their inspections" ON inspection_ziplines;
CREATE POLICY "Users can manage ziplines for their inspections" ON inspection_ziplines
FOR ALL 
USING (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_ziplines.inspection_id AND inspections.inspector_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_ziplines.inspection_id AND inspections.inspector_id = auth.uid()));

-- Fix inspection_equipment
DROP POLICY IF EXISTS "Users can manage equipment for their inspections" ON inspection_equipment;
CREATE POLICY "Users can manage equipment for their inspections" ON inspection_equipment
FOR ALL 
USING (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_equipment.inspection_id AND inspections.inspector_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_equipment.inspection_id AND inspections.inspector_id = auth.uid()));

-- Fix inspection_standards
DROP POLICY IF EXISTS "Users can manage standards for their inspections" ON inspection_standards;
CREATE POLICY "Users can manage standards for their inspections" ON inspection_standards
FOR ALL 
USING (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_standards.inspection_id AND inspections.inspector_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_standards.inspection_id AND inspections.inspector_id = auth.uid()));

-- Fix inspection_summary
DROP POLICY IF EXISTS "Users can manage summary for their inspections" ON inspection_summary;
CREATE POLICY "Users can manage summary for their inspections" ON inspection_summary
FOR ALL 
USING (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_summary.inspection_id AND inspections.inspector_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM inspections WHERE inspections.id = inspection_summary.inspection_id AND inspections.inspector_id = auth.uid()));