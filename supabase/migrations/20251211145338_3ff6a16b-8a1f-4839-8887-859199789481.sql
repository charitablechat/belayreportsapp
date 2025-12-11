-- Drop existing SELECT policies that use organization membership
DROP POLICY IF EXISTS "Organization members can view conflicts" ON sync_conflicts;

-- Allow users to INSERT conflicts for inspections they own
CREATE POLICY "Users can insert conflicts for their inspections"
ON sync_conflicts FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM inspections
    WHERE inspections.id = sync_conflicts.inspection_id
    AND inspections.inspector_id = auth.uid()
  )
);

-- Allow users to UPDATE (resolve) conflicts for inspections they own
CREATE POLICY "Users can update conflicts for their inspections"
ON sync_conflicts FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM inspections
    WHERE inspections.id = sync_conflicts.inspection_id
    AND inspections.inspector_id = auth.uid()
  )
);

-- Allow users to DELETE conflicts for inspections they own
CREATE POLICY "Users can delete conflicts for their inspections"
ON sync_conflicts FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM inspections
    WHERE inspections.id = sync_conflicts.inspection_id
    AND inspections.inspector_id = auth.uid()
  )
);

-- Add SELECT policy based on inspection ownership
CREATE POLICY "Users can view conflicts for their inspections"
ON sync_conflicts FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM inspections
    WHERE inspections.id = sync_conflicts.inspection_id
    AND inspections.inspector_id = auth.uid()
  )
);