
-- Fix 1: Update trigger to skip updated_at bump for metadata-only changes
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
    -- Compare all fields EXCEPT metadata/sync fields
    -- If only these fields changed, preserve the existing updated_at
    old_compare = to_jsonb(OLD) - 'updated_at' - 'synced_at' - 'last_opened_at' - 'last_modified_by' - 'latest_report_generated_at' - 'latest_report_html' - 'report_version';
    new_compare = to_jsonb(NEW) - 'updated_at' - 'synced_at' - 'last_opened_at' - 'last_modified_by' - 'latest_report_generated_at' - 'latest_report_html' - 'report_version';
    
    IF old_compare = new_compare THEN
      -- Only metadata fields changed — preserve existing updated_at
      NEW.updated_at = OLD.updated_at;
      RETURN NEW;
    END IF;
  END IF;
  
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

-- Fix 2: Create align_synced_at RPC for post-sync timestamp alignment
CREATE OR REPLACE FUNCTION public.align_synced_at(
  p_table_name text,
  p_record_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result_row record;
BEGIN
  -- Only allow specific tables
  IF p_table_name NOT IN ('inspections', 'trainings', 'daily_assessments') THEN
    RETURN jsonb_build_object('error', 'Invalid table name');
  END IF;

  IF p_table_name = 'inspections' THEN
    UPDATE inspections SET synced_at = updated_at WHERE id = p_record_id
    RETURNING updated_at, synced_at INTO result_row;
  ELSIF p_table_name = 'trainings' THEN
    UPDATE trainings SET synced_at = updated_at WHERE id = p_record_id
    RETURNING updated_at, synced_at INTO result_row;
  ELSIF p_table_name = 'daily_assessments' THEN
    UPDATE daily_assessments SET synced_at = updated_at WHERE id = p_record_id
    RETURNING updated_at, synced_at INTO result_row;
  END IF;

  IF result_row IS NULL THEN
    RETURN jsonb_build_object('error', 'Record not found');
  END IF;

  RETURN jsonb_build_object(
    'updated_at', result_row.updated_at,
    'synced_at', result_row.synced_at
  );
END;
$$;

-- Fix 3: One-time alignment of all existing records with timestamp drift
UPDATE inspections SET synced_at = updated_at WHERE synced_at IS NOT NULL AND updated_at > synced_at;
UPDATE trainings SET synced_at = updated_at WHERE synced_at IS NOT NULL AND updated_at > synced_at;
UPDATE daily_assessments SET synced_at = updated_at WHERE synced_at IS NOT NULL AND updated_at > synced_at;
