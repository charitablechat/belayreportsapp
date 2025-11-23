-- Add last_opened_at column to track when inspections are viewed
ALTER TABLE public.inspections 
ADD COLUMN last_opened_at TIMESTAMP WITH TIME ZONE;

-- Add index for efficient sorting by last_opened_at
CREATE INDEX idx_inspections_last_opened_at ON public.inspections(last_opened_at DESC NULLS LAST);

-- Add comment explaining the column
COMMENT ON COLUMN public.inspections.last_opened_at IS 'Timestamp of when the inspection was last opened/viewed by a user';