-- Add unique constraints to daily assessment tables for proper upsert behavior
-- Using DO blocks to check if constraints already exist

-- Beginning of day table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_bod_assessment_item'
  ) THEN
    ALTER TABLE daily_assessment_beginning_of_day 
    ADD CONSTRAINT unique_bod_assessment_item UNIQUE (assessment_id, item_key);
  END IF;
END $$;

-- End of day table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_eod_assessment_item'
  ) THEN
    ALTER TABLE daily_assessment_end_of_day 
    ADD CONSTRAINT unique_eod_assessment_item UNIQUE (assessment_id, item_key);
  END IF;
END $$;

-- Equipment checks table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_equipment_assessment_item'
  ) THEN
    ALTER TABLE daily_assessment_equipment_checks 
    ADD CONSTRAINT unique_equipment_assessment_item UNIQUE (assessment_id, item_key);
  END IF;
END $$;

-- Structure checks table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_structure_assessment_item'
  ) THEN
    ALTER TABLE daily_assessment_structure_checks 
    ADD CONSTRAINT unique_structure_assessment_item UNIQUE (assessment_id, item_key);
  END IF;
END $$;

-- Environment checks table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_environment_assessment_item'
  ) THEN
    ALTER TABLE daily_assessment_environment_checks 
    ADD CONSTRAINT unique_environment_assessment_item UNIQUE (assessment_id, item_key);
  END IF;
END $$;

-- Operating systems table (unique on assessment_id + system_name)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_operating_system_assessment'
  ) THEN
    ALTER TABLE daily_assessment_operating_systems 
    ADD CONSTRAINT unique_operating_system_assessment UNIQUE (assessment_id, system_name);
  END IF;
END $$;