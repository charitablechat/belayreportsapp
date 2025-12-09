-- Add other_description column to support custom operating systems
ALTER TABLE daily_assessment_operating_systems 
ADD COLUMN IF NOT EXISTS other_description text;