ALTER TABLE inspection_equipment
  ALTER COLUMN production_year TYPE text
  USING production_year::text;