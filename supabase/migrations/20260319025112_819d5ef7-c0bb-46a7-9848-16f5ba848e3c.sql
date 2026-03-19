CREATE OR REPLACE FUNCTION public.prevent_inspector_id_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.inspector_id IS NOT NULL 
     AND NEW.inspector_id IS DISTINCT FROM OLD.inspector_id 
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'inspector_id cannot be modified after creation.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public';