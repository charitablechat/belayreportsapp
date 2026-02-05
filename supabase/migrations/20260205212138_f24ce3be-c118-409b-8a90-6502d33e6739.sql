-- Create Security Definer function to check record status
-- This bypasses RLS to allow checking if a record was soft-deleted
-- even when the user's RLS policies would normally block the SELECT
CREATE OR REPLACE FUNCTION public.check_record_status(
  p_table_name TEXT,
  p_record_id UUID
) RETURNS TABLE (
  record_exists BOOLEAN,
  is_deleted BOOLEAN,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID,
  updated_at TIMESTAMPTZ
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate table name to prevent SQL injection
  -- Only allow specific tables that have soft-delete columns
  IF p_table_name NOT IN ('inspections', 'trainings', 'daily_assessments') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;
  
  -- Query the appropriate table based on validated table name
  IF p_table_name = 'inspections' THEN
    RETURN QUERY
    SELECT 
      TRUE as record_exists,
      i.deleted_at IS NOT NULL as is_deleted,
      i.deleted_at,
      i.deleted_by,
      i.updated_at
    FROM inspections i
    WHERE i.id = p_record_id;
  ELSIF p_table_name = 'trainings' THEN
    RETURN QUERY
    SELECT 
      TRUE as record_exists,
      t.deleted_at IS NOT NULL as is_deleted,
      t.deleted_at,
      t.deleted_by,
      t.updated_at
    FROM trainings t
    WHERE t.id = p_record_id;
  ELSIF p_table_name = 'daily_assessments' THEN
    RETURN QUERY
    SELECT 
      TRUE as record_exists,
      da.deleted_at IS NOT NULL as is_deleted,
      da.deleted_at,
      da.deleted_by,
      da.updated_at
    FROM daily_assessments da
    WHERE da.id = p_record_id;
  END IF;
  
  -- If no rows returned from any table, record doesn't exist
  RETURN;
END;
$$;

-- Add comment explaining the function's purpose
COMMENT ON FUNCTION public.check_record_status(TEXT, UUID) IS 
'Security Definer function that checks record status bypassing RLS. 
Used by sync manager to detect soft-deleted records that would otherwise 
be invisible to regular users due to RLS policies requiring deleted_at IS NULL.';