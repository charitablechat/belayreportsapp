
-- 1. Redefine is_super_admin() to check for 'admin' role
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
$$;

-- 2. Create is_backup_admin() for Kale-only backup access
CREATE OR REPLACE FUNCTION public.is_backup_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() = '759e973e-2484-4db3-862a-0cb2ec6d6ea3'::uuid
$$;

-- 3. Update backup_history RLS policy to use is_backup_admin()
DROP POLICY IF EXISTS "Super admins can manage backup history" ON public.backup_history;
CREATE POLICY "Backup admin can manage backup history"
ON public.backup_history
FOR ALL
TO authenticated
USING (is_backup_admin())
WITH CHECK (is_backup_admin());

-- 4. Update database-backups storage policy to use is_backup_admin()
DROP POLICY IF EXISTS "Super admins can manage database backups" ON storage.objects;
CREATE POLICY "Backup admin can manage database backups"
ON storage.objects
FOR ALL
TO authenticated
USING ((bucket_id = 'database-backups'::text) AND is_backup_admin())
WITH CHECK ((bucket_id = 'database-backups'::text) AND is_backup_admin());
