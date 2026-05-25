-- 1. contact-attachments: scope INSERT to user folder, add owner SELECT
DROP POLICY IF EXISTS "Users can upload contact attachments" ON storage.objects;

CREATE POLICY "Users can upload contact attachments to own folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'contact-attachments'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can read own contact attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'contact-attachments'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

-- 2. global_field_history: make append-only (only usage_count / last_used_at may change)
CREATE OR REPLACE FUNCTION public.global_field_history_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.field_type IS DISTINCT FROM OLD.field_type
     OR NEW.value IS DISTINCT FROM OLD.value
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'global_field_history is append-only: only usage_count and last_used_at may be updated'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS global_field_history_append_only_trg ON public.global_field_history;
CREATE TRIGGER global_field_history_append_only_trg
BEFORE UPDATE ON public.global_field_history
FOR EACH ROW
EXECUTE FUNCTION public.global_field_history_append_only();