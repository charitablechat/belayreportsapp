-- Clean up duplicate training reports, keeping only the most recent for each training
DELETE FROM training_reports a
USING training_reports b
WHERE a.training_id = b.training_id
  AND a.generated_at < b.generated_at;

-- Add unique constraint on training_id to prevent future duplicates
ALTER TABLE public.training_reports 
ADD CONSTRAINT training_reports_training_id_unique UNIQUE (training_id);

-- Create trigger function to auto-increment version on updates
CREATE OR REPLACE FUNCTION public.increment_training_report_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version := COALESCE(OLD.version, 0) + 1;
  NEW.generated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for version increment
CREATE TRIGGER training_report_version_trigger
BEFORE UPDATE ON public.training_reports
FOR EACH ROW
EXECUTE FUNCTION public.increment_training_report_version();