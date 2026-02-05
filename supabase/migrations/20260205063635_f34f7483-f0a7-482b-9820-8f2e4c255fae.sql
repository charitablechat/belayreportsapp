-- Add last_modified_by column to track who modified reports
-- This will show "Report modified by" when a Super Admin edits another user's report

-- Add last_modified_by column to inspections
ALTER TABLE inspections 
ADD COLUMN last_modified_by UUID REFERENCES profiles(id);

-- Add last_modified_by column to trainings
ALTER TABLE trainings 
ADD COLUMN last_modified_by UUID REFERENCES profiles(id);

-- Add last_modified_by column to daily_assessments
ALTER TABLE daily_assessments 
ADD COLUMN last_modified_by UUID REFERENCES profiles(id);