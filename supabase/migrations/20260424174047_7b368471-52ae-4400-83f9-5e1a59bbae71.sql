-- 1. Fix is_super_admin: was checking 'admin' instead of 'super_admin'
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role = 'super_admin'
  )
$function$;

-- 2. Harden soft_delete_record so the caller must own the row OR be admin/super_admin.
--    Also enforces that p_deleted_by matches auth.uid() (or caller is admin) so a
--    client cannot spoof another user's id.
CREATE OR REPLACE FUNCTION public.soft_delete_record(
  p_table_name text,
  p_record_id uuid,
  p_deleted_by uuid,
  p_retention_days integer DEFAULT 60
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_owner uuid;
  v_is_admin boolean := public.is_admin_or_above();
  v_rows integer;
BEGIN
  IF p_table_name NOT IN ('inspections', 'trainings', 'daily_assessments') THEN
    RAISE EXCEPTION 'Invalid table name: %', p_table_name;
  END IF;

  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Fetch the current owner (inspector_id) for ownership check
  EXECUTE format('SELECT inspector_id FROM %I WHERE id = $1', p_table_name)
    INTO v_owner
    USING p_record_id;

  IF v_owner IS NULL THEN
    -- Either record doesn't exist or has no owner; require admin to proceed
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Record not found or not owned by caller';
    END IF;
  ELSIF v_owner <> v_caller AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Permission denied: only the owner or an admin can delete this record';
  END IF;

  -- Force deleted_by to the actual caller unless an admin is acting on behalf
  IF NOT v_is_admin THEN
    p_deleted_by := v_caller;
  ELSIF p_deleted_by IS NULL THEN
    p_deleted_by := v_caller;
  END IF;

  EXECUTE format(
    'UPDATE %I SET deleted_at = NOW(), deleted_by = $1, retention_until = NOW() + ($2 || '' days'')::interval WHERE id = $3 AND deleted_at IS NULL',
    p_table_name
  ) USING p_deleted_by, p_retention_days::text, p_record_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$function$;

-- 3. Tighten user-level UPDATE policies on inspections & trainings so the USING
--    clause matches the SELECT clause (deleted_at IS NULL). Existing daily_assessments
--    user policy is already correct.
DROP POLICY IF EXISTS "Users can update their own inspections" ON public.inspections;
CREATE POLICY "Users can update their own inspections"
  ON public.inspections
  FOR UPDATE
  TO authenticated
  USING ((inspector_id = auth.uid()) AND (deleted_at IS NULL))
  WITH CHECK (inspector_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own trainings" ON public.trainings;
CREATE POLICY "Users can update their own trainings"
  ON public.trainings
  FOR UPDATE
  TO authenticated
  USING ((inspector_id = auth.uid()) AND (deleted_at IS NULL))
  WITH CHECK (inspector_id = auth.uid());

-- 4. Allow authenticated users to call the hardened soft_delete_record RPC
GRANT EXECUTE ON FUNCTION public.soft_delete_record(text, uuid, uuid, integer) TO authenticated;