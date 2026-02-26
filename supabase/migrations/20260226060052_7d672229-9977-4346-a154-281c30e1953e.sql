
-- Add last_sync_source column to all three report tables
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS last_sync_source text;
ALTER TABLE trainings ADD COLUMN IF NOT EXISTS last_sync_source text;
ALTER TABLE daily_assessments ADD COLUMN IF NOT EXISTS last_sync_source text;

-- Update the update_updated_at_column() function to exclude last_sync_source
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  old_compare jsonb;
  new_compare jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_compare = to_jsonb(OLD) - 'updated_at' - 'synced_at' - 'last_opened_at' - 'last_modified_by' - 'latest_report_generated_at' - 'latest_report_html' - 'report_version' - 'last_sync_source';
    new_compare = to_jsonb(NEW) - 'updated_at' - 'synced_at' - 'last_opened_at' - 'last_modified_by' - 'latest_report_generated_at' - 'latest_report_html' - 'report_version' - 'last_sync_source';
    
    IF old_compare = new_compare THEN
      NEW.updated_at = OLD.updated_at;
      RETURN NEW;
    END IF;
  END IF;
  
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;
