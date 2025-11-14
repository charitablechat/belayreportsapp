-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS plpgsql;

-- Create migration_audit table to track all migrations
CREATE TABLE IF NOT EXISTS public.migration_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_name TEXT NOT NULL,
  table_affected TEXT NOT NULL,
  records_before INTEGER,
  records_after INTEGER,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'rolled_back')),
  error_message TEXT,
  backup_table_name TEXT,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  performed_by UUID REFERENCES auth.users(id),
  metadata JSONB
);

-- Enable RLS on migration_audit
ALTER TABLE public.migration_audit ENABLE ROW LEVEL SECURITY;

-- Only super admins can view migration audit logs
CREATE POLICY "Super admins can view migration audit logs"
  ON public.migration_audit
  FOR SELECT
  USING (is_super_admin());

-- Function to backup any table with a timestamped name
CREATE OR REPLACE FUNCTION public.backup_table(
  p_table_name TEXT,
  p_schema_name TEXT DEFAULT 'public'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_backup_name TEXT;
  v_full_table_name TEXT;
  v_record_count INTEGER;
BEGIN
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
$$;

-- Function to get record count for a table
CREATE OR REPLACE FUNCTION public.get_table_record_count(
  p_table_name TEXT,
  p_schema_name TEXT DEFAULT 'public'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  EXECUTE format(
    'SELECT COUNT(*)::INTEGER FROM %I.%I',
    p_schema_name,
    p_table_name
  ) INTO v_count;
  
  RETURN v_count;
END;
$$;

-- Function to check for data loss (alerts if more than 10% loss)
CREATE OR REPLACE FUNCTION public.check_data_loss(
  p_table_name TEXT,
  p_records_before INTEGER,
  p_schema_name TEXT DEFAULT 'public'
)
RETURNS TABLE (
  has_data_loss BOOLEAN,
  records_before INTEGER,
  records_after INTEGER,
  loss_percentage NUMERIC,
  alert_level TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_records_after INTEGER;
  v_loss_percentage NUMERIC;
  v_has_loss BOOLEAN;
  v_alert_level TEXT;
BEGIN
  -- Get current record count
  v_records_after := get_table_record_count(p_table_name, p_schema_name);
  
  -- Calculate loss percentage
  IF p_records_before > 0 THEN
    v_loss_percentage := ((p_records_before - v_records_after)::NUMERIC / p_records_before::NUMERIC) * 100;
  ELSE
    v_loss_percentage := 0;
  END IF;
  
  -- Determine if there's data loss and alert level
  v_has_loss := v_loss_percentage > 0;
  
  IF v_loss_percentage > 50 THEN
    v_alert_level := 'CRITICAL';
  ELSIF v_loss_percentage > 10 THEN
    v_alert_level := 'HIGH';
  ELSIF v_loss_percentage > 0 THEN
    v_alert_level := 'MEDIUM';
  ELSE
    v_alert_level := 'NONE';
  END IF;
  
  -- Log if significant data loss detected
  IF v_loss_percentage > 10 THEN
    RAISE WARNING 'Data loss detected in table %: %.2f%% loss (%->% records)', 
      p_table_name, v_loss_percentage, p_records_before, v_records_after;
  END IF;
  
  RETURN QUERY SELECT 
    v_has_loss,
    p_records_before,
    v_records_after,
    ROUND(v_loss_percentage, 2),
    v_alert_level;
END;
$$;

-- Function to start a migration audit log
CREATE OR REPLACE FUNCTION public.start_migration_audit(
  p_migration_name TEXT,
  p_table_affected TEXT,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_audit_id UUID;
  v_records_before INTEGER;
  v_backup_name TEXT;
BEGIN
  -- Get current record count
  BEGIN
    v_records_before := get_table_record_count(p_table_affected);
  EXCEPTION WHEN OTHERS THEN
    v_records_before := NULL; -- Table might not exist yet
  END;
  
  -- Create backup if table exists
  IF v_records_before IS NOT NULL THEN
    v_backup_name := backup_table(p_table_affected);
  END IF;
  
  -- Create audit log entry
  INSERT INTO public.migration_audit (
    migration_name,
    table_affected,
    records_before,
    status,
    backup_table_name,
    performed_by,
    metadata
  ) VALUES (
    p_migration_name,
    p_table_affected,
    v_records_before,
    'started',
    v_backup_name,
    auth.uid(),
    p_metadata
  )
  RETURNING id INTO v_audit_id;
  
  RAISE NOTICE 'Migration audit started: % (ID: %)', p_migration_name, v_audit_id;
  
  RETURN v_audit_id;
END;
$$;

-- Function to complete a migration audit log
CREATE OR REPLACE FUNCTION public.complete_migration_audit(
  p_audit_id UUID,
  p_status TEXT DEFAULT 'completed',
  p_error_message TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_affected TEXT;
  v_records_after INTEGER;
  v_records_before INTEGER;
BEGIN
  -- Get table name and before count
  SELECT table_affected, records_before
  INTO v_table_affected, v_records_before
  FROM public.migration_audit
  WHERE id = p_audit_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Migration audit record not found: %', p_audit_id;
  END IF;
  
  -- Get current record count
  BEGIN
    v_records_after := get_table_record_count(v_table_affected);
  EXCEPTION WHEN OTHERS THEN
    v_records_after := NULL;
  END;
  
  -- Update audit log
  UPDATE public.migration_audit
  SET 
    status = p_status,
    records_after = v_records_after,
    completed_at = NOW(),
    error_message = p_error_message
  WHERE id = p_audit_id;
  
  -- Check for data loss if completed successfully
  IF p_status = 'completed' AND v_records_before IS NOT NULL AND v_records_after IS NOT NULL THEN
    PERFORM check_data_loss(v_table_affected, v_records_before);
  END IF;
  
  RAISE NOTICE 'Migration audit completed: % (Status: %)', p_audit_id, p_status;
END;
$$;

-- Function to restore from backup
CREATE OR REPLACE FUNCTION public.restore_from_backup(
  p_backup_table_name TEXT,
  p_target_table_name TEXT,
  p_schema_name TEXT DEFAULT 'public'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_records_restored INTEGER;
BEGIN
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
$$;

-- Create index on migration_audit for quick lookups
CREATE INDEX IF NOT EXISTS idx_migration_audit_table ON public.migration_audit(table_affected);
CREATE INDEX IF NOT EXISTS idx_migration_audit_status ON public.migration_audit(status);
CREATE INDEX IF NOT EXISTS idx_migration_audit_started_at ON public.migration_audit(started_at DESC);

-- Add comment to migration_audit table
COMMENT ON TABLE public.migration_audit IS 'Tracks all database migrations with before/after record counts and backup information';
COMMENT ON FUNCTION public.backup_table IS 'Creates a timestamped backup of any table';
COMMENT ON FUNCTION public.check_data_loss IS 'Checks for data loss after migration and alerts if more than 10% loss';
COMMENT ON FUNCTION public.start_migration_audit IS 'Starts a migration audit log and creates automatic backup';
COMMENT ON FUNCTION public.complete_migration_audit IS 'Completes a migration audit log and checks for data loss';
COMMENT ON FUNCTION public.restore_from_backup IS 'Restores a table from a backup';