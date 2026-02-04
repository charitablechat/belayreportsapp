-- Allow NULL for has_documentation to match UI "Not Set" state
-- This fixes the constraint violation when standards are initialized with null

ALTER TABLE inspection_standards 
ALTER COLUMN has_documentation DROP NOT NULL;