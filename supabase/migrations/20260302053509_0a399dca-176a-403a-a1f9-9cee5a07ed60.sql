
ALTER TABLE inspection_systems ADD COLUMN display_order integer NOT NULL DEFAULT 0;
ALTER TABLE inspection_ziplines ADD COLUMN display_order integer NOT NULL DEFAULT 0;
ALTER TABLE inspection_equipment ADD COLUMN display_order integer NOT NULL DEFAULT 0;
