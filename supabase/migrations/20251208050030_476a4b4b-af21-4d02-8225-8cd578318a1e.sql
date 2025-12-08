-- Add started_at column to inspections table
ALTER TABLE public.inspections
ADD COLUMN started_at timestamp with time zone DEFAULT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN public.inspections.started_at IS 'Timestamp when inspector starts working on the inspection (vs created_at which is when draft was created)';