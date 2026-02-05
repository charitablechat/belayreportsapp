-- Change previous_inspection_date from date to text to support special values ("N/A", "Unknown")
ALTER TABLE public.inspections 
  ALTER COLUMN previous_inspection_date TYPE text 
  USING previous_inspection_date::text;

-- Add comment for documentation
COMMENT ON COLUMN public.inspections.previous_inspection_date IS 
  'Stores either a date string (YYYY-MM-DD), "N/A" (never inspected), or "Unknown" (date not recorded)';