CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_admin_or_above());

CREATE OR REPLACE FUNCTION public.audit_resolve_users(_user_ids uuid[])
RETURNS TABLE(id uuid, first_name text, last_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p.id, p.first_name, p.last_name
  FROM public.profiles p
  WHERE p.id = ANY(_user_ids)
    AND public.is_admin_or_above();
$$;