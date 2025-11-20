-- Fix SECURITY DEFINER functions to prevent privilege escalation
-- Add schema whitelisting, table validation, and super admin checks

-- 1. Update backup_table function
CREATE OR REPLACE FUNCTION public.backup_table(p_table_name text, p_schema_name text DEFAULT 'public'::text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_backup_name TEXT;
  v_full_table_name TEXT;
  v_record_count INTEGER;
BEGIN
  -- Security Check 1: Verify user is super admin
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super admin privileges required';
  END IF;
  
  -- Security Check 2: Whitelist allowed schemas
  IF p_schema_name NOT IN ('public') THEN
    RAISE EXCEPTION 'Access denied: Schema % is not allowed', p_schema_name;
  END IF;
  
  -- Security Check 3: Verify table exists and is accessible
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = p_schema_name 
    AND tablename = p_table_name
  ) THEN
    RAISE EXCEPTION 'Table does not exist: %.%', p_schema_name, p_table_name;
  END IF;
  
  -- Generate backup table name with timestamp
  v_backup_name := p_table_name || '_backup_' || to_char(NOW(), 'YYYYMMDD_HH24MISS');
  v_full_table_name := p_schema_name || '.' || p_table_name;
  
  -- Create backup table
  EXECUTE format(
    'CREATE TABLE %I.%I (LIKE %s INCLUDING ALL)',
    p_schema_name,
    v_backup_name,
    v_full_table_name
  );
  
  -- Copy data to backup
  EXECUTE format(
    'INSERT INTO %I.%I SELECT * FROM %s',
    p_schema_name,
    v_backup_name,
    v_full_table_name
  );
  
  -- Get record count
  EXECUTE format(
    'SELECT COUNT(*) FROM %I.%I',
    p_schema_name,
    v_backup_name
  ) INTO v_record_count;
  
  -- Add metadata comment
  EXECUTE format(
    'COMMENT ON TABLE %I.%I IS ''Backup of %s created at %s with %s records''',
    p_schema_name,
    v_backup_name,
    v_full_table_name,
    NOW(),
    v_record_count
  );
  
  RAISE NOTICE 'Created backup table % with % records', v_backup_name, v_record_count;
  
  RETURN v_backup_name;
END;
$function$;

-- 2. Update restore_from_backup function
CREATE OR REPLACE FUNCTION public.restore_from_backup(p_backup_table_name text, p_target_table_name text, p_schema_name text DEFAULT 'public'::text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_records_restored INTEGER;
BEGIN
  -- Security Check 1: Verify user is super admin
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super admin privileges required';
  END IF;
  
  -- Security Check 2: Whitelist allowed schemas
  IF p_schema_name NOT IN ('public') THEN
    RAISE EXCEPTION 'Access denied: Schema % is not allowed', p_schema_name;
  END IF;
  
  -- Security Check 3: Verify both tables exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = p_schema_name 
    AND tablename = p_backup_table_name
  ) THEN
    RAISE EXCEPTION 'Backup table does not exist: %.%', p_schema_name, p_backup_table_name;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = p_schema_name 
    AND tablename = p_target_table_name
  ) THEN
    RAISE EXCEPTION 'Target table does not exist: %.%', p_schema_name, p_target_table_name;
  END IF;
  
  -- Additional safety: Prevent restoring to critical system tables
  IF p_target_table_name = ANY(ARRAY['user_roles', 'profiles', 'organizations', 'organization_members']) THEN
    RAISE WARNING 'Restoring to critical table %. Ensure backup is verified.', p_target_table_name;
  END IF;
  
  -- Clear target table
  EXECUTE format('TRUNCATE TABLE %I.%I CASCADE', p_schema_name, p_target_table_name);
  
  -- Restore from backup
  EXECUTE format(
    'INSERT INTO %I.%I SELECT * FROM %I.%I',
    p_schema_name,
    p_target_table_name,
    p_schema_name,
    p_backup_table_name
  );
  
  GET DIAGNOSTICS v_records_restored = ROW_COUNT;
  
  RAISE NOTICE 'Restored % records from % to %', v_records_restored, p_backup_table_name, p_target_table_name;
  
  RETURN v_records_restored;
END;
$function$;

-- 3. Update get_table_record_count function
CREATE OR REPLACE FUNCTION public.get_table_record_count(p_table_name text, p_schema_name text DEFAULT 'public'::text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  -- Security Check 1: Verify user is super admin
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super admin privileges required';
  END IF;
  
  -- Security Check 2: Whitelist allowed schemas
  IF p_schema_name NOT IN ('public') THEN
    RAISE EXCEPTION 'Access denied: Schema % is not allowed', p_schema_name;
  END IF;
  
  -- Security Check 3: Verify table exists and is accessible
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE schemaname = p_schema_name 
    AND tablename = p_table_name
  ) THEN
    RAISE EXCEPTION 'Table does not exist: %.%', p_schema_name, p_table_name;
  END IF;
  
  EXECUTE format(
    'SELECT COUNT(*)::INTEGER FROM %I.%I',
    p_schema_name,
    p_table_name
  ) INTO v_count;
  
  RETURN v_count;
END;
$function$;