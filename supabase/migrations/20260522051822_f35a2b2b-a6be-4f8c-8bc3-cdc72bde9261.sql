-- 1. Trigger: invalidate training report cache on any training_photos write.
CREATE OR REPLACE FUNCTION public.invalidate_training_report_cache_on_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_training_id uuid;
BEGIN
  v_training_id := COALESCE(NEW.training_id, OLD.training_id);
  IF v_training_id IS NOT NULL THEN
    -- Clear cached report markers so the next Generate Report regenerates
    -- with the latest photos. update_updated_at_column() strips both columns
    -- from its no-op comparison, so updated_at is NOT advanced by this write,
    -- preventing spurious sync/conflict signals.
    UPDATE public.trainings
       SET latest_report_generated_at = NULL,
           latest_report_html = NULL
     WHERE id = v_training_id
       AND (latest_report_generated_at IS NOT NULL
            OR latest_report_html IS NOT NULL);
  END IF;
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Never block the underlying photo write because of cache bookkeeping.
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS invalidate_training_report_cache_on_photo_change
  ON public.training_photos;

CREATE TRIGGER invalidate_training_report_cache_on_photo_change
AFTER INSERT OR UPDATE OR DELETE ON public.training_photos
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_training_report_cache_on_photo();

-- 2. Storage: allow regular admins to read training-photos objects so signed
-- URLs work for non-owner admin viewers. SELECT only. Owner uploads remain
-- intact; super-admin ALL policy remains intact. Bucket stays private.
DROP POLICY IF EXISTS "Admins can view all training photos storage"
  ON storage.objects;

CREATE POLICY "Admins can view all training photos storage"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'training-photos'
  AND public.is_admin_or_above()
);
