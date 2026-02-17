
-- Add soft-delete columns to all photo tables
ALTER TABLE public.inspection_photos 
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_until timestamptz;

ALTER TABLE public.training_photos 
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_until timestamptz;

ALTER TABLE public.daily_assessment_photos 
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_until timestamptz;

-- Update the cleanup function to also purge expired photo records
CREATE OR REPLACE FUNCTION public.cleanup_expired_deleted_records()
 RETURNS TABLE(inspections_deleted integer, trainings_deleted integer, daily_assessments_deleted integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Delete expired photo records
  DELETE FROM public.inspection_photos
  WHERE deleted_at IS NOT NULL
    AND retention_until IS NOT NULL
    AND retention_until < NOW();

  DELETE FROM public.training_photos
  WHERE deleted_at IS NOT NULL
    AND retention_until IS NOT NULL
    AND retention_until < NOW();

  DELETE FROM public.daily_assessment_photos
  WHERE deleted_at IS NOT NULL
    AND retention_until IS NOT NULL
    AND retention_until < NOW();

  RETURN QUERY SELECT v_inspections_count, v_trainings_count, v_assessments_count;
END;
$function$;
