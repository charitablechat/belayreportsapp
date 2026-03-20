ALTER TABLE inspection_systems ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE inspection_equipment ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE inspection_ziplines ADD COLUMN IF NOT EXISTS photo_url text;