
-- Fix soft_delete_record: add table whitelist validation
CREATE OR REPLACE FUNCTION public.soft_delete_record(p_table_name text, p_record_id uuid, p_deleted_by uuid, p_retention_days integer DEFAULT 60)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Whitelist allowed tables
  IF p_table_name NOT IN ('inspections', 'trainings', 'daily_assessments') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;

  -- Security check: must be authenticated
  IF p_deleted_by IS NULL THEN
    RAISE EXCEPTION 'User ID is required for soft delete';
  END IF;

  EXECUTE format(
    'UPDATE %I SET deleted_at = NOW(), deleted_by = $1, retention_until = NOW() + interval ''%s days'' WHERE id = $2 AND deleted_at IS NULL',
    p_table_name,
    p_retention_days
  ) USING p_deleted_by, p_record_id;

  RETURN FOUND;
END;
$function$;

-- Fix restore_deleted_record: add table whitelist validation
CREATE OR REPLACE FUNCTION public.restore_deleted_record(p_table_name text, p_record_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Whitelist allowed tables
  IF p_table_name NOT IN ('inspections', 'trainings', 'daily_assessments') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;

  -- Security check: only super admins can restore
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super admin privileges required';
  END IF;

  EXECUTE format(
    'UPDATE %I SET deleted_at = NULL, deleted_by = NULL, retention_until = NULL WHERE id = $1 AND deleted_at IS NOT NULL',
    p_table_name
  ) USING p_record_id;

  RETURN FOUND;
END;
$function$;
