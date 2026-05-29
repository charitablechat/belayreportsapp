-- Defense-in-depth: make user_roles mutation policies explicit.
-- RLS is already enabled and only SELECT policies exist today, so INSERT/UPDATE/DELETE
-- are already denied for `authenticated` via default-deny. We add explicit super-admin-only
-- policies so the intent is auditable and a future permissive policy added by mistake
-- cannot silently grant self-assignment of admin/super_admin roles.

CREATE POLICY "Only super admins can insert user roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin());

CREATE POLICY "Only super admins can update user roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

CREATE POLICY "Only super admins can delete user roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.is_super_admin());

-- Allow admins (not just super-admins) to read inspection-report PDFs from storage.
-- The existing "Users can read their own reports" policy already grants super_admin
-- via the joined check, but admins with is_admin_or_above() have table-level access
-- without matching storage access. Add an explicit admin SELECT policy on the bucket.
CREATE POLICY "Admins can read all inspection report PDFs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'inspection-reports'
  AND public.is_admin_or_above()
);
