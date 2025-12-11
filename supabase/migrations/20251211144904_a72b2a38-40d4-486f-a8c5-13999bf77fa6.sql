-- Add unique constraints to prevent duplicate items in daily assessment tables
-- This ensures each (assessment_id, item_key) combination is unique

-- Beginning of Day
ALTER TABLE daily_assessment_beginning_of_day 
ADD CONSTRAINT unique_bod_assessment_item UNIQUE (assessment_id, item_key);

-- End of Day
ALTER TABLE daily_assessment_end_of_day 
ADD CONSTRAINT unique_eod_assessment_item UNIQUE (assessment_id, item_key);

-- Equipment Checks
ALTER TABLE daily_assessment_equipment_checks 
ADD CONSTRAINT unique_equipment_assessment_item UNIQUE (assessment_id, item_key);

-- Structure Checks
ALTER TABLE daily_assessment_structure_checks 
ADD CONSTRAINT unique_structure_assessment_item UNIQUE (assessment_id, item_key);

-- Environment Checks
ALTER TABLE daily_assessment_environment_checks 
ADD CONSTRAINT unique_environment_assessment_item UNIQUE (assessment_id, item_key);

-- Operating Systems (unique by assessment and system_name)
ALTER TABLE daily_assessment_operating_systems 
ADD CONSTRAINT unique_os_assessment_system UNIQUE (assessment_id, system_name);