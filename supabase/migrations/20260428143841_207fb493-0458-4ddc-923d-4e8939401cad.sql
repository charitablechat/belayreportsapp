DROP POLICY IF EXISTS "Admins can insert admin edit snapshots" ON public.admin_edit_snapshots;

CREATE POLICY "Admins can insert admin edit snapshots"
ON public.admin_edit_snapshots
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin_or_above());