-- First, delete duplicate summaries keeping the most recent one per inspection
DELETE FROM inspection_summary a
USING inspection_summary b
WHERE a.inspection_id = b.inspection_id 
  AND a.created_at < b.created_at;

-- Now add the unique constraint so upsert with onConflict works correctly
ALTER TABLE inspection_summary 
ADD CONSTRAINT inspection_summary_inspection_id_unique 
UNIQUE (inspection_id);