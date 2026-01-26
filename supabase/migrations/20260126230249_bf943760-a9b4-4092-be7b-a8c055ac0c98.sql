-- Add soft-delete columns to inspections table
ALTER TABLE public.inspections
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by UUID DEFAULT NULL,
ADD COLUMN IF NOT EXISTS retention_until TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add soft-delete columns to trainings table
ALTER TABLE public.trainings
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by UUID DEFAULT NULL,
ADD COLUMN IF NOT EXISTS retention_until TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add soft-delete columns to daily_assessments table
ALTER TABLE public.daily_assessments
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by UUID DEFAULT NULL,
ADD COLUMN IF NOT EXISTS retention_until TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Create index for efficient querying of active vs deleted records
CREATE INDEX IF NOT EXISTS idx_inspections_deleted_at ON public.inspections(deleted_at);
CREATE INDEX IF NOT EXISTS idx_trainings_deleted_at ON public.trainings(deleted_at);
CREATE INDEX IF NOT EXISTS idx_daily_assessments_deleted_at ON public.daily_assessments(deleted_at);

-- Create index for cleanup job to find expired records
CREATE INDEX IF NOT EXISTS idx_inspections_retention_until ON public.inspections(retention_until) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trainings_retention_until ON public.trainings(retention_until) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_daily_assessments_retention_until ON public.daily_assessments(retention_until) WHERE deleted_at IS NOT NULL;

-- Create a helper function to soft-delete records with retention period
CREATE OR REPLACE FUNCTION public.soft_delete_record(
  p_table_name TEXT,
  p_record_id UUID,
  p_deleted_by UUID,
  p_retention_days INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
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
$$;

-- Create a helper function to restore soft-deleted records
CREATE OR REPLACE FUNCTION public.restore_deleted_record(
  p_table_name TEXT,
  p_record_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
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
$$;

-- Create a function to permanently delete expired records (for cleanup job)
CREATE OR REPLACE FUNCTION public.cleanup_expired_deleted_records()
RETURNS TABLE(
  inspections_deleted INTEGER,
  trainings_deleted INTEGER,
  daily_assessments_deleted INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inspections_count INTEGER;
  v_trainings_count INTEGER;
  v_assessments_count INTEGER;
BEGIN
  -- Delete expired inspections
  DELETE FROM public.inspections
  WHERE deleted_at IS NOT NULL
    AND retention_until IS NOT NULL
    AND retention_until < NOW();
  GET DIAGNOSTICS v_inspections_count = ROW_COUNT;

  -- Delete expired trainings
  DELETE FROM public.trainings
  WHERE deleted_at IS NOT NULL
    AND retention_until IS NOT NULL
    AND retention_until < NOW();
  GET DIAGNOSTICS v_trainings_count = ROW_COUNT;

  -- Delete expired daily assessments
  DELETE FROM public.daily_assessments
  WHERE deleted_at IS NOT NULL
    AND retention_until IS NOT NULL
    AND retention_until < NOW();
  GET DIAGNOSTICS v_assessments_count = ROW_COUNT;

  RETURN QUERY SELECT v_inspections_count, v_trainings_count, v_assessments_count;
END;
$$;

-- Create a function to get deleted records for recovery UI
CREATE OR REPLACE FUNCTION public.get_deleted_records(
  p_table_name TEXT DEFAULT NULL
)
RETURNS TABLE(
  table_name TEXT,
  record_id UUID,
  deleted_at TIMESTAMP WITH TIME ZONE,
  deleted_by UUID,
  retention_until TIMESTAMP WITH TIME ZONE,
  days_remaining INTEGER,
  organization TEXT,
  record_date DATE,
  deleter_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Security check: only super admins can view deleted records
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super admin privileges required';
  END IF;

  RETURN QUERY
  WITH deleted_data AS (
    -- Inspections
    SELECT 
      'inspections'::TEXT as tbl,
      i.id,
      i.deleted_at,
      i.deleted_by,
      i.retention_until,
      i.organization,
      i.inspection_date::DATE as rec_date
    FROM public.inspections i
    WHERE i.deleted_at IS NOT NULL
      AND (p_table_name IS NULL OR p_table_name = 'inspections')
    
    UNION ALL
    
    -- Trainings
    SELECT 
      'trainings'::TEXT,
      t.id,
      t.deleted_at,
      t.deleted_by,
      t.retention_until,
      t.organization,
      t.start_date::DATE
    FROM public.trainings t
    WHERE t.deleted_at IS NOT NULL
      AND (p_table_name IS NULL OR p_table_name = 'trainings')
    
    UNION ALL
    
    -- Daily Assessments
    SELECT 
      'daily_assessments'::TEXT,
      d.id,
      d.deleted_at,
      d.deleted_by,
      d.retention_until,
      d.organization,
      d.assessment_date::DATE
    FROM public.daily_assessments d
    WHERE d.deleted_at IS NOT NULL
      AND (p_table_name IS NULL OR p_table_name = 'daily_assessments')
  )
  SELECT 
    dd.tbl,
    dd.id,
    dd.deleted_at,
    dd.deleted_by,
    dd.retention_until,
    GREATEST(0, EXTRACT(DAY FROM (dd.retention_until - NOW()))::INTEGER) as days_remaining,
    dd.organization,
    dd.rec_date,
    COALESCE(NULLIF(TRIM(CONCAT(p.first_name, ' ', p.last_name)), ''), 'Unknown')::TEXT as deleter_name
  FROM deleted_data dd
  LEFT JOIN public.profiles p ON p.id = dd.deleted_by
  ORDER BY dd.deleted_at DESC;
END;
$$;

-- Add comments for documentation
COMMENT ON COLUMN public.inspections.deleted_at IS 'Timestamp when record was soft-deleted (NULL = active)';
COMMENT ON COLUMN public.inspections.deleted_by IS 'User ID who performed the deletion';
COMMENT ON COLUMN public.inspections.retention_until IS 'Date after which record can be permanently deleted';

COMMENT ON COLUMN public.trainings.deleted_at IS 'Timestamp when record was soft-deleted (NULL = active)';
COMMENT ON COLUMN public.trainings.deleted_by IS 'User ID who performed the deletion';
COMMENT ON COLUMN public.trainings.retention_until IS 'Date after which record can be permanently deleted';

COMMENT ON COLUMN public.daily_assessments.deleted_at IS 'Timestamp when record was soft-deleted (NULL = active)';
COMMENT ON COLUMN public.daily_assessments.deleted_by IS 'User ID who performed the deletion';
COMMENT ON COLUMN public.daily_assessments.retention_until IS 'Date after which record can be permanently deleted';