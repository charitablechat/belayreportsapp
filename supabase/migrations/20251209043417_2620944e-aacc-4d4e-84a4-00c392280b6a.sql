-- Clean up duplicate inspection reports, keeping only the most recent for each inspection
DELETE FROM inspection_reports a
USING inspection_reports b
WHERE a.inspection_id = b.inspection_id
  AND a.generated_at < b.generated_at;

-- Add unique constraint on inspection_id to prevent future duplicates
ALTER TABLE public.inspection_reports 
ADD CONSTRAINT inspection_reports_inspection_id_unique UNIQUE (inspection_id);

-- Create trigger function to auto-increment version on updates
CREATE OR REPLACE FUNCTION public.increment_inspection_report_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version := COALESCE(OLD.version, 0) + 1;
  NEW.generated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for version increment
CREATE TRIGGER inspection_report_version_trigger
BEFORE UPDATE ON public.inspection_reports
FOR EACH ROW
EXECUTE FUNCTION public.increment_inspection_report_version();